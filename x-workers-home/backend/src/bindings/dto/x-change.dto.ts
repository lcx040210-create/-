import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class XChangeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^@?[A-Za-z0-9_]{1,15}$/, { message: 'X handle 格式不正确' })
  handle: string;
}
