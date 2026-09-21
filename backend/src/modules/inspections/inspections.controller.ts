import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import {
  CreateInspectionDto,
  ListInspectionsQueryDto,
  UpdateInspectionDto,
} from './dto/inspection-request.dto';
import {
  InspectionDto,
  InspectionListDto,
} from './dto/inspection-response.dto';
import { InspectionsService } from './inspections.service';

const APPLICATION_NOT_FOUND =
  'No such application in your department scope (also: a draft, another department’s, or not assigned to you — all indistinguishable).';
const FORBIDDEN =
  'INSUFFICIENT_ROLE / INSUFFICIENT_PERMISSION — your role cannot do this.';

/**
 * Requesting / assigning / scheduling an inspection, from the application's
 * side (Blueprint 13.7 `POST /applications/:id/inspections`, under the
 * `/officer` prefix like every other officer route).
 *
 * The Scrutiny Officer the application is assigned to is the only role that
 * may write (FRD 4.3); the Department Administrator and Approving Authority
 * may read what they can already see. There is deliberately NO route that
 * takes a status — it is derived from the schedule — and none that completes
 * an inspection (reports are a later step).
 */
@ApiTags('Inspections')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('SCRUTINY_OFFICER', 'DEPT_ADMIN', 'APPROVING_AUTHORITY')
@Controller('officer/applications/:applicationId/inspections')
export class ApplicationInspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Post()
  @Roles('SCRUTINY_OFFICER')
  @ApiOperation({
    summary: 'Request an inspection and assign an inspector',
    description:
      'The assigned Scrutiny Officer names an active Inspector of the application’s department and the site, and optionally a future date/time. With a date/time the inspection is SCHEDULED, without it PENDING — the status is never sent. Allowed while the application is under scrutiny; one open inspection per application. Does not change the application’s state.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiCreatedResponse({ type: InspectionDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_ERROR (e.g. a past date).',
  })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: APPLICATION_NOT_FOUND })
  @ApiConflictResponse({
    description: 'INSPECTION_ALREADY_OPEN, or INSPECTION_NOT_MODIFIABLE.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_ASSIGNEE, or INSPECTOR_CONFLICT_OF_INTEREST.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: CreateInspectionDto,
    @Req() req: Request,
  ): Promise<InspectionDto> {
    return this.inspections.create(
      user.userId,
      applicationId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get()
  @ApiOperation({
    summary: 'The inspections of one application',
    description: 'Newest first. Officer roles that can see the application.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: [InspectionDto] })
  @ApiNotFoundResponse({ description: APPLICATION_NOT_FOUND })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<InspectionDto[]> {
    return this.inspections.listForApplication(user.userId, applicationId);
  }

  @Put(':inspectionId')
  @Roles('SCRUTINY_OFFICER')
  @ApiOperation({
    summary: 'Reassign the inspector, or set / move the schedule or site',
    description:
      'Only an open (PENDING / SCHEDULED) inspection can change, and only while scrutiny is under way. Changing the inspector needs a `reason` and an eligible inspector; setting a date makes a PENDING inspection SCHEDULED. The inspector’s own confirm / reschedule is a later step.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'inspectionId', format: 'uuid' })
  @ApiOkResponse({ type: InspectionDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_ERROR (nothing changes, a past date, no reason).',
  })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({
    description: `${APPLICATION_NOT_FOUND} Also: an inspection that belongs to another application.`,
  })
  @ApiConflictResponse({ description: 'INSPECTION_NOT_MODIFIABLE.' })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_ASSIGNEE, or INSPECTOR_CONFLICT_OF_INTEREST.',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('inspectionId', ParseUUIDPipe) inspectionId: string,
    @Body() dto: UpdateInspectionDto,
    @Req() req: Request,
  ): Promise<InspectionDto> {
    return this.inspections.update(
      user.userId,
      applicationId,
      inspectionId,
      dto,
      req.ip ?? 'unknown',
    );
  }
}

/**
 * Viewing inspections (Blueprint 13.7 `GET /inspections/:id`). An Inspector
 * sees only inspections assigned to them — and only the minimum needed to
 * conduct the visit (FRD 4.4); the officer roles see those of the applications
 * they may already see. Anything else is a 404. The applicant's own view of an
 * inspection (FRD 24.1) is a later step.
 */
@ApiTags('Inspections')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('INSPECTOR', 'SCRUTINY_OFFICER', 'DEPT_ADMIN', 'APPROVING_AUTHORITY')
@Controller('inspections')
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Inspections I may see',
    description:
      'Paginated; soonest first (unscheduled last), stable ordering. Filters only narrow — access is always decided from your own roles.',
  })
  @ApiOkResponse({ type: InspectionListDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR.' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInspectionsQueryDto,
  ): Promise<InspectionListDto> {
    return this.inspections.list(user.userId, query);
  }

  @Get(':inspectionId')
  @ApiOperation({ summary: 'One inspection' })
  @ApiParam({ name: 'inspectionId', format: 'uuid' })
  @ApiOkResponse({ type: InspectionDto })
  @ApiNotFoundResponse({
    description:
      'No such inspection in your scope (nonexistent, another department’s, another inspector’s — all indistinguishable).',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('inspectionId', ParseUUIDPipe) inspectionId: string,
  ): Promise<InspectionDto> {
    return this.inspections.get(user.userId, inspectionId);
  }
}
