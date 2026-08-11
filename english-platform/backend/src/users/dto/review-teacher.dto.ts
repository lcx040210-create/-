import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { ReviewStatus } from '../entities/teacher-profile.entity';

export class ReviewTeacherDto {
  @IsEnum(ReviewStatus)
  review_status: ReviewStatus;

  @IsNumber()
  @Min(0)
  @IsOptional()
  base_rate?: number;
}
