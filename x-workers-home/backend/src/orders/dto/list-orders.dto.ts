import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { OrderType } from '../order.entity';

export class ListOrdersDto {
  @IsOptional()
  @IsIn(['post', 'comment', 'quote'])
  type?: OrderType;

  /** new：最新发布（默认）；price：单价降序。 */
  @IsOptional()
  @IsIn(['new', 'price'])
  sort?: 'new' | 'price';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
