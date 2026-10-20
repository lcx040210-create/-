import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
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

  // 同意的条款版本：必须等于当前生效版本，否则 400（T19）
  @IsOptional()
  @IsInt()
  @Min(1)
  termsVersion?: number;
}
