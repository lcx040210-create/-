import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderType } from '../order.entity';

export class OrderRequirementsDto {
  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @IsArray()
  @IsString({ each: true })
  hashtags: string[];

  @IsArray()
  @IsString({ each: true })
  mentions: string[];

  @IsArray()
  @IsString({ each: true })
  links: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  minChars?: number;
}

export class CreateOrderDto {
  @IsIn(['post', 'comment', 'quote'], { message: '商单类型不合法' })
  type: OrderType;

  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(120, { message: '标题最多 120 字' })
  title: string;

  @IsString()
  @IsNotEmpty({ message: '说明不能为空' })
  brief: string;

  @IsDefined({ message: '缺少交付要求' })
  @IsObject()
  @ValidateNested()
  @Type(() => OrderRequirementsDto)
  requirements: OrderRequirementsDto;

  @IsOptional()
  @IsString()
  targetTweetUrl?: string;

  /** 十进制字符串，必须是 ≥1 的整数 XM（服务端复核）。 */
  @IsString()
  @IsNotEmpty()
  priceXm: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  slots: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}
