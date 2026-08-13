import { IsNotEmpty, IsString, IsNumber, Max } from 'class-validator';

export class InitiateUploadDto {
  @IsNotEmpty()
  @IsString()
  filename: string;

  @IsNotEmpty()
  @IsNumber()
  @Max(10737418240) // 10GB
  fileSizeBytes: number;

  @IsNotEmpty()
  @IsString()
  mimeType: string;
}
