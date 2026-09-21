import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { APPLICATION_READ_LEVEL } from '../applications/constants/application.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import {
  CurrentEnterpriseAccess,
  EnterpriseAccessRequired,
} from '../enterprises/decorators/enterprise-access.decorator';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import {
  AddSlaHolidayDto,
  ListSlaQueryDto,
  UpdateSlaStageDto,
} from './dto/sla-request.dto';
import {
  ApplicantSlaDto,
  OfficerSlaDto,
  OfficerSlaListDto,
  SlaHolidayDto,
  SlaStageConfigDto,
} from './dto/sla-response.dto';
import { SlaAdminService } from './sla-admin.service';
import { SlaViewService } from './sla-view.service';

const OFFICER_ROLES = [
  'SCRUTINY_OFFICER',
  'DEPT_ADMIN',
  'APPROVING_AUTHORITY',
] as const;

/**
 * The applicant's SLA information (FRD 25.1), read-only, through the same
 * enterprise / project / representative access as every applicant route:
 * `EnterpriseAccessGuard` is the only authorisation mechanism here.
 */
@ApiTags('SLA')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller(
  'enterprises/:enterpriseId/projects/:projectId/applications/:applicationId/sla',
)
export class ApplicantSlaController {
  constructor(private readonly view: SlaViewService) {}

  @Get()
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({
    summary: 'SLA / timeline information for my application',
    description:
      'Submission date, current stage, elapsed time since submission and status. The expected date appears ONLY where the owning department has configured a timeline; otherwise `timelineMessage` says "Timeline not yet configured" (FRD 25.3). No breach flag or department workload is shown.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: ApplicantSlaDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_SCOPE.' })
  @ApiNotFoundResponse({
    description:
      'No such application in this project (another enterprise / project is indistinguishable).',
  })
  get(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ApplicantSlaDto> {
    return this.view.forApplicant(access, projectId, applicationId);
  }
}

/** The officer's SLA views (FRD 25.2, Blueprint OFF-04). Read-only: no route
 * anywhere sets, moves or clears a deadline. */
@ApiTags('SLA')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(...OFFICER_ROLES)
@Controller('officer')
export class OfficerSlaController {
  constructor(private readonly view: SlaViewService) {}

  @Get('sla')
  @ApiOperation({
    summary: 'SLA queue: countdown per application, most urgent first',
    description:
      'The SLA clocks of exactly the applications your role can already see (a Scrutiny Officer: those assigned to them; a Department Administrator: the department; an Approving Authority: those awaiting a decision). Filter by status or breached.',
  })
  @ApiOkResponse({ type: OfficerSlaListDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSlaQueryDto,
  ): Promise<OfficerSlaListDto> {
    return this.view.listForOfficer(user.userId, query);
  }

  @Get('applications/:applicationId/sla')
  @ApiOperation({
    summary: 'The SLA clock of one application',
    description:
      'Deadline, remaining time, the "Breached" indicator, the warning state, and every pause period.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: OfficerSlaDto })
  @ApiNotFoundResponse({
    description:
      'Nonexistent, a draft, or outside your department / assignment scope — all indistinguishable.',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<OfficerSlaDto> {
    return this.view.forOfficer(user.userId, applicationId);
  }
}

/**
 * SLA configuration (Blueprint ADM-04 "Stages, dependencies, SLA"; FRD 21).
 * A stage's duration and pause rule are the Department Administrator's, for the
 * stages their department acts on; a System Administrator can never change them
 * (FRD 35.2). The holiday calendar is the Department Administrator's for their
 * own department and the System Administrator's for the state-wide one.
 */
@ApiTags('SLA')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('admin/sla')
export class SlaAdminController {
  constructor(private readonly admin: SlaAdminService) {}

  @Get('stages')
  @Roles('DEPT_ADMIN')
  @ApiOperation({
    summary: 'Workflow stages of my department and their SLA configuration',
  })
  @ApiOkResponse({ type: [SlaStageConfigDto] })
  stages(@CurrentUser() user: AuthenticatedUser): Promise<SlaStageConfigDto[]> {
    return this.admin.listStages(user.userId);
  }

  @Put('stages/:workflowStageId')
  @Roles('DEPT_ADMIN')
  @ApiOperation({
    summary: 'Configure a stage’s SLA duration and pause rule',
    description:
      'Sets `slaDays` (working days; null returns the stage to "Timeline not yet configured") and / or `pauseOnQuery`. Applies to applications submitted afterwards: a running clock keeps the configuration it started under. Audited with before and after.',
  })
  @ApiParam({ name: 'workflowStageId', format: 'uuid' })
  @ApiOkResponse({ type: SlaStageConfigDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR (or no change).' })
  @ApiForbiddenResponse({ description: 'INSUFFICIENT_ROLE.' })
  @ApiNotFoundResponse({
    description:
      'Nonexistent, or a stage of a department you do not administer.',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workflowStageId', ParseUUIDPipe) stageId: string,
    @Body() dto: UpdateSlaStageDto,
    @Req() req: Request,
  ): Promise<SlaStageConfigDto> {
    return this.admin.updateStage(
      user.userId,
      stageId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get('holidays')
  @Roles('DEPT_ADMIN', 'SYSTEM_ADMIN')
  @ApiOperation({
    summary: 'The holiday calendar you may see',
    description:
      'A Department Administrator: the state-wide holidays and their departments’; a System Administrator: all.',
  })
  @ApiOkResponse({ type: [SlaHolidayDto] })
  holidays(@CurrentUser() user: AuthenticatedUser): Promise<SlaHolidayDto[]> {
    return this.admin.listHolidays(user.userId);
  }

  @Post('holidays')
  @Roles('DEPT_ADMIN', 'SYSTEM_ADMIN')
  @ApiOperation({
    summary: 'Add a holiday (working days skip it)',
    description:
      'A Department Administrator adds to their own department’s calendar (`departmentId` required); a System Administrator adds to the state-wide calendar (`departmentId` omitted). Deadlines of clocks already running are not recalculated.',
  })
  @ApiCreatedResponse({ type: SlaHolidayDto })
  @ApiConflictResponse({ description: 'HOLIDAY_ALREADY_EXISTS.' })
  @ApiForbiddenResponse({
    description: 'A department you do not administer.',
  })
  addHoliday(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddSlaHolidayDto,
    @Req() req: Request,
  ): Promise<SlaHolidayDto> {
    return this.admin.addHoliday(user.userId, dto, req.ip ?? 'unknown');
  }

  @Delete('holidays/:holidayId')
  @Roles('DEPT_ADMIN', 'SYSTEM_ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a holiday from a calendar you maintain' })
  @ApiParam({ name: 'holidayId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description: 'Nonexistent, or in a calendar you do not maintain.',
  })
  async removeHoliday(
    @CurrentUser() user: AuthenticatedUser,
    @Param('holidayId', ParseUUIDPipe) holidayId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.admin.removeHoliday(user.userId, holidayId, req.ip ?? 'unknown');
  }
}
