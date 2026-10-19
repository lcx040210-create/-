import { IsNotEmpty, IsString } from 'class-validator';

export class RequestWithdrawalDto {
  /** 十进制字符串，如 "50"；具体规则（≥50、整十）由服务端校验 */
  @IsString()
  @IsNotEmpty()
  amountXm: string;
}
