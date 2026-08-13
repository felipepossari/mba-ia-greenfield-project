import { IsArray, ValidateNested, IsNumber, IsString } from 'class-validator';
import { Type } from 'class-transformer';

class UploadPartDto {
  @IsNumber()
  partNumber: number;

  @IsString()
  eTag: string;
}

export class CompleteUploadDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UploadPartDto)
  parts: UploadPartDto[];
}
