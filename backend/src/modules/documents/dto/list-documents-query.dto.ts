import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ListDocumentsQueryDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Also return superseded (older) versions. By default only each document’s current version is listed.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  includeHistory?: boolean;
}
