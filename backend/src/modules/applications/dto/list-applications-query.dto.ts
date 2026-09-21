import { ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicantStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

/** Optional filters for the application lists (FRD §21 filterable list). */
export class ListApplicationsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  approvalTypeId?: string;

  @ApiPropertyOptional({ enum: ApplicantStatus })
  @IsOptional()
  @IsEnum(ApplicantStatus)
  applicantStatus?: ApplicantStatus;
}

/** Enterprise-wide list: additionally narrowable to one project. */
export class ListEnterpriseApplicationsQueryDto extends ListApplicationsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}
