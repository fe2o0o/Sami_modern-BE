import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** New order of image ids; index becomes the displayOrder. */
export class ReorderImagesDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray({ message: 'قائمة الصور غير صالحة' })
  @ArrayNotEmpty({ message: 'قائمة الصور فارغة' })
  @IsUUID('4', { each: true, message: 'معرّف صورة غير صالح' })
  imageIds!: string[];
}
