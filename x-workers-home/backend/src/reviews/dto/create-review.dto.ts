import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @IsInt({ message: '评分必须是整数' })
  @Min(1, { message: '评分最低 1 星' })
  @Max(5, { message: '评分最高 5 星' })
  score: number;

  @IsOptional()
  @IsString({ message: '评价内容必须是字符串' })
  @MaxLength(1000, { message: '评价内容过长' })
  comment?: string;
}
