import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class DeliverSlotDto {
  @IsString()
  @IsNotEmpty({ message: '交付链接不能为空' })
  @MaxLength(2048, { message: '交付链接过长' })
  @Matches(/^https?:\/\/\S+$/i, { message: '交付链接必须是 http(s) 链接' })
  deliveryUrl: string;
}
