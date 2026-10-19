import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ADDRESS_PATTERN } from './nonce.dto';

export class VerifyDto {
  @IsString()
  @Matches(ADDRESS_PATTERN, { message: 'address 必须是 0x 开头的 40 位十六进制地址' })
  address: string;

  @IsString()
  @IsNotEmpty()
  signature: string;

  // 邀请码：仅首次建号时生效；已存在用户登录时忽略
  @IsOptional()
  @IsString()
  referralCode?: string;
}
