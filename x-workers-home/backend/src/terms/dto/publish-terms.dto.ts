import { IsNotEmpty, IsString } from 'class-validator';

export class PublishTermsDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  contentMd: string;
}
