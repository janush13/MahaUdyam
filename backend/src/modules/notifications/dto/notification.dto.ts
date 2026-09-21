import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export const NOTIFICATION_DEFAULT_PAGE_SIZE = 20;
export const NOTIFICATION_MAX_PAGE_SIZE = 100;

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    description: 'true: only unread; false: only read; omitted: all.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: NOTIFICATION_MAX_PAGE_SIZE,
    default: NOTIFICATION_DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_MAX_PAGE_SIZE)
  pageSize?: number;
}

/** One in-app notification (FRD 26.2). No delivery internals, no recipient
 * other than the caller, and never an officer's question, an observation or a
 * document's contents: the message says that something happened and where. */
export class NotificationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({
    description: 'The triggering event, e.g. QUERY_RAISED or SLA_BREACHED.',
  })
  eventType: string;
  @ApiProperty() title: string;
  @ApiProperty() message: string;
  @ApiProperty() read: boolean;
  @ApiProperty({ type: Date, nullable: true }) readAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  enterpriseId: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  projectId: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  applicationId: string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Non-sensitive structured facts (a due date, a schedule).',
  })
  payload: Record<string, unknown> | null;
}

export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto] }) items: NotificationDto[];
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty({ description: 'Notifications matching the filter.' })
  total: number;
  @ApiProperty({ description: 'All your unread notifications.' })
  unread: number;
}

export class UnreadCountDto {
  @ApiProperty() unread: number;
}
