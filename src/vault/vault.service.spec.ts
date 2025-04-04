import { VaultService } from './vault.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Axios, AxiosResponse } from 'axios';
import { AlgorandEncoder } from '@algorandfoundation/algo-models';
import { randomBytes } from 'crypto';
import { HttpErrorByCode } from '@nestjs/common/utils/http-error-by-code.util';
import createMockInstance from 'jest-create-mock-instance';
import { UserInfoDto } from './user-info.dto';

describe('VaultService', () => {
  let vaultService: VaultService;
  let httpService: HttpService;
  let configService: ConfigService;

  beforeAll(async () => {
    vaultService = createMockInstance(VaultService);
    configService = createMockInstance(ConfigService);
    httpService = createMockInstance(HttpService);

    Object.defineProperty(httpService, 'axiosRef', {
      value: createMockInstance(Axios),
    });
  });

  beforeEach(() => {
    jest.resetAllMocks();

    vaultService = new VaultService(httpService, configService);
  });

  describe('checkToken', () => {
    it('should return true when token is valid', async () => {
      const baseUrl = 'http://vault';
      (configService.get as jest.Mock).mockReturnValue(baseUrl);
      (httpService.axiosRef.get as jest.Mock).mockResolvedValue({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} as any },
      } as AxiosResponse);

      const result = await vaultService.checkToken('valid-token');

      expect(httpService.axiosRef.get).toHaveBeenCalledWith(`${baseUrl}/v1/auth/token/lookup-self`, {
        headers: { 'X-Vault-Token': 'valid-token' },
      });
      expect(result).toBe(true);
    });

    it('should throw error when token is invalid', async () => {
      const baseUrl = 'http://vault';
      (configService.get as jest.Mock).mockReturnValue(baseUrl);
      const error = { response: { status: 401 } };
      (httpService.axiosRef.get as jest.Mock).mockRejectedValue(error);

      await expect(vaultService.checkToken('invalid-token')).rejects.toThrow(HttpErrorByCode[401]);
    });
  });

  describe('getKeys()', () => {
    it('(\OK) should return an array of keys', async () => {
      const baseUrl = 'http://vault';
      (configService.get as jest.Mock).mockReturnValueOnce(baseUrl);

      const keysPath = 'transit/users';
      (configService.get as jest.Mock).mockReturnValueOnce(keysPath);

      (configService.get as jest.Mock).mockReturnValueOnce(baseUrl);
      (configService.get as jest.Mock).mockReturnValueOnce(baseUrl);

      const key1: Buffer = randomBytes(32);
      const keys = [key1.toString('base64'), key1.toString('base64')];

      const axiosResponse: AxiosResponse = {
        data: {
          data: {
            keys: ['user-key1', 'user-key2'],
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} as any },
      };

      (httpService.axiosRef.request as jest.Mock).mockResolvedValueOnce(axiosResponse);

      const algoEncoder: AlgorandEncoder = new AlgorandEncoder();

      // mock two calls for get keys
      (httpService.axiosRef.get as jest.Mock).mockResolvedValue({
        data: {
          data: {
            keys: {
              '1': { public_key: key1.toString('base64') },
            },
          },
        },
      });

      const result: UserInfoDto[] = await vaultService.getKeys('token');

      expect(httpService.axiosRef.request).toHaveBeenCalledWith({
        method: 'LIST',
        url: `${baseUrl}/v1/transit/users/keys`,
        headers: { 'X-Vault-Token': 'token' },
      });

      expect(result).toEqual([
        {
          user_id: 'user-key1',
          public_address: algoEncoder.encodeAddress(key1),
        },
        {
          user_id: 'user-key2',
          public_address: algoEncoder.encodeAddress(key1),
        },
      ]);
    });
  });

  describe('getUserPublicAddress (using _transitCreateKey)', () => {
    it('should create key and return encoded public address', async () => {
      const baseUrl = 'http://vault';
      const transitPath = 'transit/path';
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'VAULT_BASE_URL') return baseUrl;
        if (key === 'VAULT_TRANSIT_USERS_PATH') return transitPath;
      });

      // Use a fake public key that matches what you expect (e.g. "managerPublicKey").
      const publicKey: Buffer = randomBytes(32);
      const base64PublicKey = Buffer.from(publicKey).toString('base64');
      const axiosResponse: AxiosResponse = {
        data: {
          data: {
            keys: {
              '1': { public_key: base64PublicKey },
            },
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} as any },
      };

      (httpService.axiosRef.get as jest.Mock).mockResolvedValue(axiosResponse);

      const result = await vaultService.getUserPublicAddress('user-key', 'token');

      expect(httpService.axiosRef.get).toHaveBeenCalledWith(`${baseUrl}/v1/${transitPath}/keys/user-key`, {
        headers: { 'X-Vault-Token': 'token' },
      });
      expect(result).toBe(new AlgorandEncoder().encodeAddress(publicKey));
    });

    it('\(FAIL) should throw 403 when lacking permissions', async () => {
      const baseUrl = 'http://vault';
      const transitPath = 'transit/path';
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'VAULT_BASE_URL') return baseUrl;
        if (key === 'VAULT_TRANSIT_USERS_PATH') return transitPath;
      });
      const error = { response: { status: 403 } };
      (httpService.axiosRef.get as jest.Mock).mockRejectedValue(error);

      // check code to be 403
      await expect(vaultService.getUserPublicAddress('user-key', 'token')).rejects.toThrow(HttpErrorByCode[403]);
    });
  });

  describe('signAsUser (using _sign)', () => {
    it('should sign data and return a Uint8Array signature', async () => {
      const transitPath = 'transit/users';
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'VAULT_TRANSIT_USERS_PATH') return transitPath;
      });
      const fakeData = new Uint8Array([1, 2, 3]);
      // Construct a signature string in the expected vault format: "vault:<version>:<base64-signature>"
      const rawSignature = 'signature';
      const signatureBase64 = Buffer.from(rawSignature).toString('base64');
      const vaultSignature = `vault:1:${signatureBase64}`;
      const axiosResponse: AxiosResponse = {
        data: { data: { signature: vaultSignature } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} as any },
      };
      (httpService.axiosRef.post as jest.Mock).mockResolvedValue(axiosResponse);

      const result = await vaultService.signAsUser('user-key', fakeData, 'token');

      const expected = new Uint8Array(Buffer.from(rawSignature));
      expect(httpService.axiosRef.post).toHaveBeenCalledWith(
        expect.stringContaining(`${transitPath}/sign/user-key`),
        { input: Buffer.from(fakeData).toString('base64') },
        { headers: { 'X-Vault-Token': 'token' } },
      );
      expect(result).toEqual(expected);
    });

    it('should throw UnauthorizedException when vault returns 401 in _sign', async () => {
      const transitPath = 'transit/users';
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'VAULT_TRANSIT_USERS_PATH') return transitPath;
      });
      const error = { response: { status: 401 } };
      (httpService.axiosRef.post as jest.Mock).mockRejectedValue(error);

      const fakeData = new Uint8Array([1, 2, 3]);
      await expect(vaultService.signAsUser('user-key', fakeData, 'token')).rejects.toThrow(HttpErrorByCode[401]);
    });
  });

  describe('signAsManager', () => {
    it('should sign data for manager and return a Uint8Array signature', async () => {
      const transitPath = 'transit/managers';
      const managerId = 'manager-key';
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'VAULT_TRANSIT_MANAGERS_PATH') return transitPath;
        if (key === 'VAULT_MANAGER_KEY') return managerId;
      });
      const fakeData = new Uint8Array([4, 5, 6]);
      const rawSignature = 'managerSignature';
      const signatureBase64 = Buffer.from(rawSignature).toString('base64');
      const vaultSignature = `vault:1:${signatureBase64}`;
      const axiosResponse: AxiosResponse = {
        data: { data: { signature: vaultSignature } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} as any },
      };
      (httpService.axiosRef.post as jest.Mock).mockResolvedValue(axiosResponse);

      const result = await vaultService.signAsManager(fakeData, 'token');

      const expected = new Uint8Array(Buffer.from(rawSignature));
      expect(httpService.axiosRef.post).toHaveBeenCalledWith(
        expect.stringContaining(`${transitPath}/sign/${managerId}`),
        { input: Buffer.from(fakeData).toString('base64') },
        { headers: { 'X-Vault-Token': 'token' } },
      );
      expect(result).toEqual(expected);
    });

    it('should throw InternalServerErrorException for unknown error in _sign (manager)', async () => {
      const transitPath = 'transit/managers';
      const managerId = 'manager-key';
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'VAULT_TRANSIT_MANAGERS_PATH') return transitPath;
        if (key === 'VAULT_MANAGER_KEY') return managerId;
      });
      const error = { response: { status: 500 } };
      (httpService.axiosRef.post as jest.Mock).mockRejectedValue(error);

      const fakeData = new Uint8Array([4, 5, 6]);
      await expect(vaultService.signAsManager(fakeData, 'token')).rejects.toThrow(HttpErrorByCode[500]);
    });
  });

  describe('getManagerPublicAddress', () => {
    it('should create key for manager and return encoded public address', async () => {
      const baseUrl = 'http://vault';
      const transitPath = 'transit/managers';
      const managerId = 'manager-key';
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'VAULT_BASE_URL') return baseUrl;
        if (key === 'VAULT_TRANSIT_MANAGERS_PATH') return transitPath;
        if (key === 'VAULT_MANAGER_KEY') return managerId;
      });

      const fakePublicKey = 'managerPublicKey';
      const fakePublicKeyBase64 = Buffer.from(fakePublicKey).toString('base64');
      const axiosResponse: AxiosResponse = {
        data: {
          data: {
            keys: {
              '1': { public_key: fakePublicKeyBase64 },
            },
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} as any },
      };
      (httpService.axiosRef.get as jest.Mock).mockResolvedValue(axiosResponse);

      const result = await vaultService.getManagerPublicAddress('token');

      expect(httpService.axiosRef.get).toHaveBeenCalledWith(`${baseUrl}/v1/${transitPath}/keys/${managerId}`, {
        headers: { 'X-Vault-Token': 'token' },
      });
      expect(result).toBe('NVQW4YLHMVZFA5LCNRUWGS3FPFNFYR4K');
    });
  });

  // --- Direct tests of the private methods to improve coverage ---
  describe('Private method _sign', () => {
    it('should split the vault signature correctly and decode it', async () => {
      const transitPath = 'transit/private';
      const fakeData = new Uint8Array([7, 8, 9]);
      const baseUrl = 'http://vault';
      (configService.get as jest.Mock).mockReturnValue(baseUrl);
      // Prepare a vault signature with the expected format so that split returns an array with at least 3 elements.
      const rawSignature = 'privateSig';
      const signatureBase64 = Buffer.from(rawSignature).toString('base64');
      const fakeVaultSignature = `vault:1:${signatureBase64}`;
      const axiosResponse: AxiosResponse = {
        data: { data: { signature: fakeVaultSignature } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} as any },
      };
      (httpService.axiosRef.post as jest.Mock).mockResolvedValue(axiosResponse);

      // Directly invoke the private method _sign using bracket notation.
      const result: Uint8Array = await (vaultService as any)._sign('private-key', transitPath, fakeData, 'token');
      expect(result).toEqual(new Uint8Array(Buffer.from(rawSignature)));
    });
  });

  describe('Private method _transitGetKey', () => {
    it('should extract public key and call AlgorandEncoder correctly', async () => {
      const transitPath = 'transit/private';
      const keyName = 'private-key';
      const baseUrl = 'http://vault';
      (configService.get as jest.Mock).mockReturnValue(baseUrl);

      // Use a fake public key that we expect.
      const publicKey = randomBytes(32);
      const publicKey64 = Buffer.from(publicKey).toString('base64');
      const axiosResponse: AxiosResponse = {
        data: { data: { keys: { '1': { public_key: publicKey64 } } } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} as any },
      };
      (httpService.axiosRef.post as jest.Mock).mockResolvedValue(axiosResponse);

      // Directly call the private method.
      const result: string = await (vaultService as any).transitCreateKey(keyName, transitPath, 'token');
      // We don't know the exact encoding output, but we expect a string.
      expect(result).toBe(new AlgorandEncoder().encodeAddress(publicKey));
    });
  });
});
