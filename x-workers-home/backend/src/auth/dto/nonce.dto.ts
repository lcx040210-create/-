import { IsString, Matches } from 'class-validator';

export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export class NonceDto {
  @IsString()
  @Matches(ADDRESS_PATTERN, { message: 'address 必须是 0x 开头的 40 位十六进制地址' })
  address: string;
}
