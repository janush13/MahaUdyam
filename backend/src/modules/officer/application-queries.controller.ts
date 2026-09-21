import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
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
import { RespondToQueryDto } from './dto/officer-request.dto';
import { ApplicantQueryDto } from './dto/officer-response.dto';
import { QueriesService } from './queries.service';

/**
 * The applicant's side of the query / response record (FRD 19.1; Blueprint
 * 13.6 `POST /queries/:id/respond`), nested under the application so the
 * EXISTING EnterpriseAccessGuard authorises it:
 *  - reading the queries: any live scope (View Only "views applications/status");
 *  - answering: Full Delegation or the owner — FRD 20.3 lists "respond to
 *    queries" only under Full Delegation (Prepare & Submit prepares and
 *    submits, it does not answer the department).
 * The applicant never edits the question, and the department never edits an
 * answer: both are immutable records.
 */
@ApiTags('Applications')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller(
  'enterprises/:enterpriseId/projects/:projectId/applications/:applicationId/queries',
)
export class ApplicationQueriesController {
  constructor(private readonly queries: QueriesService) {}

  @Get()
  @EnterpriseAccessRequired('VIEW_ONLY')
  @ApiOperation({
    summary: 'The department’s queries on this application, and your answers',
    description:
      'Shows the department (not an individual officer), the question in plain language, and any response. Internal officer observations are never included.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: [ApplicantQueryDto] })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_SCOPE.' })
  list(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ApplicantQueryDto[]> {
    return this.queries.listForApplicant(access, projectId, applicationId);
  }

  @Post(':queryId/respond')
  @HttpCode(200)
  @EnterpriseAccessRequired('FULL')
  @ApiOperation({
    summary: 'Answer an open query (QUERY_RAISED → APPLICANT_RESPONDED)',
    description:
      'Requires Full Delegation or the owner. The response is written once and never edited. Documents the query asked for are uploaded through the documents endpoints, which are open to the applicant while a query is open.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'queryId', format: 'uuid' })
  @ApiOkResponse({ type: ApplicantQueryDto })
  @ApiNotFoundResponse({ description: 'No such query on this application.' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_SCOPE.' })
  @ApiConflictResponse({ description: 'QUERY_NOT_OPEN.' })
  respond(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('queryId', ParseUUIDPipe) queryId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RespondToQueryDto,
    @Req() req: Request,
  ): Promise<ApplicantQueryDto> {
    return this.queries.respond(
      access,
      projectId,
      applicationId,
      queryId,
      user.userId,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
