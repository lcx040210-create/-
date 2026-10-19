import { IsNotEmpty, IsString } from 'class-validator';

export class WalletChangeDto {
  @IsString()
  @IsNotEmpty()
  newAddress: string;

  @IsString()
  @IsNotEmpty()
  signature: string;
}
