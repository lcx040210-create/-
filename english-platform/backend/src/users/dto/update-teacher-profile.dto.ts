import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateTeacherProfileDto {
  @IsString()
  @IsOptional()
  display_name?: string;

  @IsString()
  @IsOptional()
  intro?: string;

  @IsArray()
  @IsOptional()
  exam_types?: string[];

  @IsArray()
  @IsOptional()
  skills?: string[];

  @IsArray()
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  avatar_url?: string;
}
