import {
  Body,
  Controller,
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
  CurrentEnterpriseAccess,
  EnterpriseAccessRequired,
} from '../enterprises/decorators/enterprise-access.decorator';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { ValidationSummary } from './application-readiness';
import { ApplicationsService } from './applications.service';
import {
  APPLICATION_READ_LEVEL,
  APPLICATION_WRITE_LEVEL,
} from './constants/application.constants';
import {
  ApplicationResponseDto,
  ApplicationStatusDto,
  ValidationSummaryDto,
} from './dto/application-response.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import {
  ListApplicationsQueryDto,
  ListEnterpriseApplicationsQueryDto,
} from './dto/list-applications-query.dto';
import { SubmitApplicationDto } from './dto/submit-application.dto';
import { UpdateApplicationDraftDto } from './dto/update-application-draft.dto';

const FORBIDDEN_DESCRIPTION =
  'FORBIDDEN_SCOPE — scope or project restriction insufficient.';

/**
 * Nested under the enterprise / project (Blueprint §13.4's `/applications`, in
 * this API's enterprise-nested form, like Steps 6 and 7) so the existing
 * EnterpriseAccessGuard resolves the caller's relationship from
 * `:enterpriseId` and checks a project-restricted representative's list
 * against `:projectId`. That guard is the ONLY authorisation mechanism here.
 *
 * There is deliberately no status endpoint that WRITES: an application's
 * status changes only through the explicit actions (`submit`), never by a
 * client naming a status.
 */
@ApiTags('Applications')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller('enterprises/:enterpriseId')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post('projects/:projectId/applications')
  @EnterpriseAccessRequired(APPLICATION_WRITE_LEVEL)
  @ApiOperation({
    summary:
      'Start an application (draft) for an approval suggested by a stored discovery result',
    description:
      'Creates a DRAFT application for the project in the URL. The body names the approval and the stored discovery snapshot it was suggested in — discovery is not re-run, and the application permanently records that snapshot and the rule version behind it. No enterprise/project/owner field is accepted. Requires PREPARE_SUBMIT or above for representatives; a representative restricted to specific projects can only act on those. One live application per approval per project.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiCreatedResponse({ type: ApplicationResponseDto })
  @ApiNotFoundResponse({
    description:
      'No live relationship to the enterprise, no such project in it, or no such discovery result for this project.',
  })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  @ApiUnprocessableEntityResponse({
    description:
      'APPROVAL_NOT_IN_DISCOVERY — the approval was not applicable in that discovery result.',
  })
  @ApiConflictResponse({
    description:
      'APPLICATION_ALREADY_EXISTS, APPROVAL_TYPE_INACTIVE or WORKFLOW_NOT_CONFIGURED.',
  })
  create(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApplicationDto,
    @Req() req: Request,
  ): Promise<ApplicationResponseDto> {
    return this.applications.create(
      access,
      projectId,
      user.userId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get('applications')
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({
    summary: "List the enterprise's applications across all its projects",
    description:
      'A representative restricted to specific projects sees only applications of those projects.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiOkResponse({ type: [ApplicationResponseDto] })
  @ApiNotFoundResponse({
    description: 'No live relationship to the enterprise.',
  })
  listForEnterprise(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Query() query: ListEnterpriseApplicationsQueryDto,
  ): Promise<ApplicationResponseDto[]> {
    return this.applications.listForEnterprise(access, query);
  }

  @Get('projects/:projectId/applications')
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({ summary: "List a project's applications, newest first" })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOkResponse({ type: [ApplicationResponseDto] })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  listForProject(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListApplicationsQueryDto,
  ): Promise<ApplicationResponseDto[]> {
    return this.applications.listForProject(access, projectId, query);
  }

  @Get('projects/:projectId/applications/:applicationId')
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({
    summary: 'View one application, including its discovery context',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: ApplicationResponseDto })
  @ApiNotFoundResponse({
    description:
      'No such application in this project (an id from another project or enterprise is indistinguishable).',
  })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  get(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ApplicationResponseDto> {
    return this.applications.get(access, projectId, applicationId);
  }

  @Get('projects/:projectId/applications/:applicationId/status')
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({
    summary: "Retrieve the application's current applicant-facing status",
    description:
      'Read-only. Status is never set by a client; it changes only through explicit actions such as submit.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: ApplicationStatusDto })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  status(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ApplicationStatusDto> {
    return this.applications.getStatus(access, projectId, applicationId);
  }

  @Put('projects/:projectId/applications/:applicationId/draft')
  @EnterpriseAccessRequired(APPLICATION_WRITE_LEVEL)
  @ApiOperation({
    summary: "Save the draft's approval-specific details (draft only)",
    description:
      'Replaces the approval-specific details. Save Draft never requires completeness. Once submitted the form is read-only (ALREADY_SUBMITTED). Only formData can be sent — never a status, project, enterprise or discovery link.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: ApplicationResponseDto })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  @ApiConflictResponse({ description: 'ALREADY_SUBMITTED.' })
  updateDraft(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateApplicationDraftDto,
    @Req() req: Request,
  ): Promise<ApplicationResponseDto> {
    return this.applications.updateDraft(
      access,
      projectId,
      applicationId,
      user.userId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post('projects/:projectId/applications/:applicationId/pre-validate')
  @HttpCode(200)
  @EnterpriseAccessRequired(APPLICATION_WRITE_LEVEL)
  @ApiOperation({
    summary: 'Run pre-submission validation (read-only)',
    description:
      'Returns errors, warnings and missing mandatory documents, and whether Submit is enabled. Always carries the mandatory disclaimer: passing does not guarantee approval. Changes nothing.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: ValidationSummaryDto })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  @ApiConflictResponse({ description: 'ALREADY_SUBMITTED.' })
  preValidate(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ValidationSummary> {
    return this.applications.preValidate(access, projectId, applicationId);
  }

  @Post('projects/:projectId/applications/:applicationId/submit')
  @HttpCode(200)
  @EnterpriseAccessRequired(APPLICATION_WRITE_LEVEL)
  @ApiOperation({
    summary: 'Submit the application (explicit DRAFT → SUBMITTED transition)',
    description:
      'Re-runs pre-submission validation, requires the mandatory declaration, then atomically moves the application to SUBMITTED and generates the permanent Application Reference Number. Submitting is not a statutory decision — the department reviews it. Requires PREPARE_SUBMIT or above.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: ApplicationResponseDto })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  @ApiConflictResponse({ description: 'ALREADY_SUBMITTED.' })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_FAILED — blocking problems (see fields).',
  })
  submit(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitApplicationDto,
    @Req() req: Request,
  ): Promise<ApplicationResponseDto> {
    return this.applications.submit(
      access,
      projectId,
      applicationId,
      user.userId,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
