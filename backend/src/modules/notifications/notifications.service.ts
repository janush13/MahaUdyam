import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ListNotificationsQueryDto,
  NOTIFICATION_DEFAULT_PAGE_SIZE,
  NotificationDto,
  NotificationListDto,
  UnreadCountDto,
} from './dto/notification.dto';
import { NotificationAccessService } from './notification-access.service';

const notFound = () =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: 'Notification not found.',
  });

export function toNotificationDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    eventType: row.eventType,
    title: row.title,
    message: row.message,
    read: row.readAt !== null,
    readAt: row.readAt,
    createdAt: row.createdAt,
    enterpriseId: row.enterpriseId,
    projectId: row.projectId,
    applicationId: row.applicationId,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
  };
}

/**
 * The caller's own notifications (Blueprint 13.11): list, read one, mark one
 * read, count the unread. Every query starts from `NotificationAccessService`'s
 * where-clause, so another user's notification - or one about an application
 * the caller can no longer see - is never returned, and a request for one is
 * the same 404 as for a nonexistent id. There is no way to create, edit or
 * delete a notification here.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: NotificationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(
    userId: string,
    query: ListNotificationsQueryDto,
  ): Promise<NotificationListDto> {
    const visible = await this.access.visibleWhere(userId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? NOTIFICATION_DEFAULT_PAGE_SIZE;
    const where: Prisma.NotificationWhereInput = {
      AND: [
        visible,
        query.unread === undefined
          ? {}
          : { readAt: query.unread ? null : { not: null } },
      ],
    };
    const [total, unread, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { AND: [visible, { readAt: null }] },
      }),
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map(toNotificationDto),
      page,
      pageSize,
      total,
      unread,
    };
  }

  async unreadCount(userId: string): Promise<UnreadCountDto> {
    const visible = await this.access.visibleWhere(userId);
    return {
      unread: await this.prisma.notification.count({
        where: { AND: [visible, { readAt: null }] },
      }),
    };
  }

  async get(userId: string, id: string): Promise<NotificationDto> {
    return toNotificationDto(await this.find(userId, id));
  }

  /** Idempotent: marking a read notification read again changes nothing and is
   * not audited twice; two simultaneous requests mark it once. */
  async markRead(
    userId: string,
    roles: readonly string[],
    id: string,
    ipAddress: string,
  ): Promise<NotificationDto> {
    const current = await this.find(userId, id);
    if (current.readAt !== null) {
      return toNotificationDto(current);
    }
    const { count } = await this.prisma.notification.updateMany({
      where: { id: current.id, userId, readAt: null },
      data: { readAt: new Date(), status: 'READ' },
    });
    if (count === 1) {
      await this.audit.record({
        userId,
        roleAtTime: roles.join(','),
        action: AuditActions.NOTIFICATION_READ,
        entityType: 'Notification',
        entityId: current.id,
        // Identifiers only: never the message.
        afterState: {
          eventType: current.eventType,
          applicationId: current.applicationId,
        },
        ipAddress,
      });
    }
    return toNotificationDto(await this.find(userId, id));
  }

  private async find(userId: string, id: string): Promise<Notification> {
    if (!isUUID(id)) {
      throw notFound();
    }
    const row = await this.prisma.notification.findFirst({
      where: { AND: [await this.access.visibleWhere(userId), { id }] },
    });
    if (!row) {
      throw notFound();
    }
    return row;
  }
}
