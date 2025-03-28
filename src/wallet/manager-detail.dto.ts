import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ManagerDetailDto {
  @IsString()
  @ApiProperty({
    example: 'I3345FUQQ2GRBHFZQPLYQQX5HJMMRZMABCHRLWV6RCJYC6OO4MOLEUBEGU',
    description: 'The public address of the manager',
  })
  public_address?: string;
}
