import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 发起争议 / 举报删帖 / 回应争议共用：一句陈述。 */
export class DisputeStatementDto {
  @IsString()
  @IsNotEmpty({ message: '说明不能为空' })
  @MaxLength(2000, { message: '说明过长' })
  statement: string;
}
