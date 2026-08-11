import { IsArray, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePackageDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsInt() @Min(1)
  lesson_count: number;

  @IsNumber() @Min(0)
  price: number;

  @IsInt() @Min(1)
  valid_days: number;

  @IsArray()
  exam_types: string[];

  @IsArray()
  skills: string[];

  @IsString() @IsOptional()
  description?: string;
}
