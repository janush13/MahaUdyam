import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import {
  ListNotificationsQueryDto,
  NotificationDto,
  NotificationListDto,
  UnreadCountDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * The in-app notification centre (Blueprint 13.11, FRD 26): any authenticated
 * user's OWN notifications. There is deliberately no route that creates, edits
 * or deletes a notification: they are raised only by the platform's own
 * transitions.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'My notifications, newest first',
    description:
      'Only your own, and only those about applications you can still see (an applicant: their enterprise / authorised projects; an officer: their department / assignment scope). Filter with `unread`.',
  })
  @ApiOkResponse({ type: NotificationListDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationListDto> {
    return this.notifications.list(user.userId, query);
  }

  // Declared before `:id` so it is never read as an id.
  @Get('unread-count')
  @ApiOperation({ summary: 'How many of my notifications are unread' })
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCountDto> {
    return this.notifications.unreadCount(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my notifications' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificationDto })
  @ApiNotFoundResponse({
    description:
      'Nonexistent, someone else’s, or about an application you can no longer see — all indistinguishable.',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationDto> {
    return this.notifications.get(user.userId, id);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark one of my notifications read',
    description:
      'Idempotent: marking a read notification read again changes nothing. Read state is one-way.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificationDto })
  @ApiNotFoundResponse({ description: 'As for the single read.' })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<NotificationDto> {
    return this.notifications.markRead(
      user.userId,
      user.roles,
      id,
      req.ip ?? 'unknown',
    );
  }
}
