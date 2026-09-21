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
  Res,
  StreamableFile,
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
  ApiProduces,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { DOWNLOAD_CACHE_CONTROL } from '../documents/constants/document.constants';
import { DocumentResponseDto } from '../documents/dto/document-response.dto';
import { ListDocumentsQueryDto } from '../documents/dto/list-documents-query.dto';
import { attachmentDisposition } from '../documents/file-validation';
import { AssignmentService } from './assignment.service';
import {
  AssignOfficerDto,
  ListOfficerApplicationsQueryDto,
  RaiseQueryDto,
  RecommendDto,
  RecordObservationDto,
  ReassignOfficerDto,
  ReviewDocumentDto,
} from './dto/officer-request.dto';
import {
  AssigneeDto,
  AssignmentResultDto,
  HistoryEntryDto,
  ObservationDto,
  OfficerApplicationDetailDto,
  OfficerApplicationListDto,
  OfficerDashboardDto,
  OfficerDiscoveryDto,
  OfficerQueryDto,
  RecommendationDto,
} from './dto/officer-response.dto';
import { OfficerWorkspaceService } from './officer-workspace.service';
import { QueriesService } from './queries.service';
import { ScrutinyResultDto, ScrutinyService } from './scrutiny.service';

const NOT_FOUND_DESCRIPTION =
  'No such application in your department scope (also: a draft, another department’s, or not assigned to you — all indistinguishable).';
const FORBIDDEN_DESCRIPTION =
  'INSUFFICIENT_ROLE / INSUFFICIENT_PERMISSION — your role cannot do this.';

/**
 * The officer workspace + scrutiny API (FRD 21/22; Blueprint 13.6, OFF-01..03).
 *
 * AUTHORISATION, in layers, none of them new:
 *   1. JWT + MFA enforcement (global; officer roles require MFA);
 *   2. `RolesGuard` — which roles may use each route at all;
 *   3. `OfficerAccessService` — object level: the application's department is
 *      derived from its approval type and compared with the caller's own
 *      role assignments; a scrutiny officer sees only what is assigned to them.
 * No client-supplied department id is ever trusted, and there is deliberately
 * NO route that takes a status: every state change is a named action.
 */
@ApiTags('Officer workspace')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('SCRUTINY_OFFICER', 'DEPT_ADMIN', 'APPROVING_AUTHORITY')
@Controller('officer')
export class OfficerController {
  constructor(
    private readonly workspace: OfficerWorkspaceService,
    private readonly scrutiny: ScrutinyService,
    private readonly queries: QueriesService,
    private readonly assignments: AssignmentService,
  ) {}

  // ---- workspace ----------------------------------------------------------

  @Get('dashboard')
  @ApiOperation({
    summary: 'Counts for your queue, within your department scope',
    description:
      'By scrutiny status, assigned to you, unassigned (Department Administrators), waiting on an applicant, awaiting the Approving Authority. SLA figures arrive with the SLA engine (a later step).',
  })
  @ApiOkResponse({ type: OfficerDashboardDto })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  dashboard(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OfficerDashboardDto> {
    return this.workspace.dashboard(user.userId);
  }

  @Get('applications')
  @ApiOperation({
    summary:
      'The officer queue: your applications, filtered, paginated, stably ordered',
    description:
      'Scrutiny Officer: applications assigned to you. Department Administrator: the department’s. Approving Authority: the department’s applications awaiting a decision. Drafts are never listed. Ordering is total (ties broken by id).',
  })
  @ApiOkResponse({ type: OfficerApplicationListDto })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOfficerApplicationsQueryDto,
  ): Promise<OfficerApplicationListDto> {
    return this.workspace.list(user.userId, query);
  }

  @Get('officers')
  @Roles('DEPT_ADMIN')
  @ApiOperation({
    summary: 'Scrutiny Officers you can assign to, with their open workload',
    description:
      'Department Administrators only, and only for departments they administer.',
  })
  @ApiOkResponse({ type: [AssigneeDto] })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  officers(@CurrentUser() user: AuthenticatedUser): Promise<AssigneeDto[]> {
    return this.assignments.listAssignees(user.userId);
  }

  @Get('applications/:applicationId')
  @ApiOperation({
    summary:
      'Open an application: data, project/enterprise context, documents, internal observations, queries',
    description:
      'The full working view. Includes the frozen submission snapshot of documents and the immutable discovery context. Opening is recorded in the audit trail. Internal observations are visible to officers only.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: OfficerApplicationDetailDto })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<OfficerApplicationDetailDto> {
    return this.workspace.detail(
      user.userId,
      applicationId,
      req.ip ?? 'unknown',
    );
  }

  @Get('applications/:applicationId/discovery')
  @ApiOperation({
    summary: 'Why this approval was suggested: the stored discovery context',
    description:
      'Read from the immutable snapshot the application was started from (rule id + version, label, explanation, dependencies). Discovery is never re-run. A recommendation, not a statutory determination.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: OfficerDiscoveryDto })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  discovery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<OfficerDiscoveryDto> {
    return this.workspace.discovery(user.userId, applicationId);
  }

  @Get('applications/:applicationId/history')
  @ApiOperation({
    summary: 'The application’s activity timeline (from the audit trail)',
    description:
      'Submission, document changes, assignment, scrutiny actions, queries and responses, recommendation — plain language, chronological, no security events.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: [HistoryEntryDto] })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<HistoryEntryDto[]> {
    return this.workspace.history(user.userId, applicationId);
  }

  // ---- assignment ---------------------------------------------------------

  @Post('applications/:applicationId/assignment')
  @Roles('DEPT_ADMIN')
  @ApiOperation({
    summary:
      'Assign an unassigned application to a Scrutiny Officer of its department',
    description:
      'Department Administrator of the application’s department only. The assignee must be an active Scrutiny Officer of that department. Records who assigned, when, and to whom.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiCreatedResponse({ type: AssignmentResultDto })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  @ApiConflictResponse({
    description: 'ALREADY_ASSIGNED, or INVALID_STATE_TRANSITION.',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_ASSIGNEE.' })
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: AssignOfficerDto,
    @Req() req: Request,
  ): Promise<AssignmentResultDto> {
    return this.assignments.assign(
      user.userId,
      applicationId,
      dto.officerUserId,
      req.ip ?? 'unknown',
    );
  }

  @Put('applications/:applicationId/assignment')
  @Roles('DEPT_ADMIN')
  @ApiOperation({
    summary:
      'Reassign an assigned application (with a reason; history is kept)',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: AssignmentResultDto })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiConflictResponse({
    description: 'NOT_ASSIGNED, or INVALID_STATE_TRANSITION.',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_ASSIGNEE.' })
  reassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: ReassignOfficerDto,
    @Req() req: Request,
  ): Promise<AssignmentResultDto> {
    return this.assignments.reassign(
      user.userId,
      applicationId,
      dto.officerUserId,
      dto.reason,
      req.ip ?? 'unknown',
    );
  }

  // ---- scrutiny -----------------------------------------------------------

  @Post('applications/:applicationId/start-scrutiny')
  @HttpCode(200)
  @Roles('SCRUTINY_OFFICER')
  @ApiOperation({
    summary: 'Start scrutiny (SUBMITTED → UNDER_SCRUTINY)',
    description:
      'The assigned Scrutiny Officer begins working the application. A named action: no status is accepted.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: ScrutinyResultDto })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiConflictResponse({ description: 'INVALID_STATE_TRANSITION.' })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<ScrutinyResultDto> {
    return this.scrutiny.startScrutiny(
      user.userId,
      applicationId,
      req.ip ?? 'unknown',
    );
  }

  @Post('applications/:applicationId/observations')
  @Roles('SCRUTINY_OFFICER')
  @ApiOperation({
    summary: 'Record an INTERNAL scrutiny observation',
    description:
      'Never shown to the applicant unless raised as a formal query. Append-only.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiCreatedResponse({ type: ObservationDto })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiConflictResponse({ description: 'INVALID_STATE_TRANSITION.' })
  observe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: RecordObservationDto,
    @Req() req: Request,
  ): Promise<ObservationDto> {
    return this.scrutiny.recordObservation(
      user.userId,
      applicationId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post('applications/:applicationId/queries')
  @Roles('SCRUTINY_OFFICER')
  @ApiOperation({
    summary: 'Raise a query to the applicant (UNDER_SCRUTINY → QUERY_RAISED)',
    description:
      'The structured clarification request. The question is immutable once raised. One query is open at a time.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiCreatedResponse({ type: OfficerQueryDto })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiConflictResponse({ description: 'INVALID_STATE_TRANSITION.' })
  raiseQuery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: RaiseQueryDto,
    @Req() req: Request,
  ): Promise<OfficerQueryDto> {
    return this.queries.raise(
      user.userId,
      applicationId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post('applications/:applicationId/queries/:queryId/close')
  @HttpCode(200)
  @Roles('SCRUTINY_OFFICER')
  @ApiOperation({
    summary:
      'Close an answered query and resume scrutiny (APPLICANT_RESPONDED → UNDER_SCRUTINY)',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'queryId', format: 'uuid' })
  @ApiOkResponse({ type: OfficerQueryDto })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiConflictResponse({
    description: 'QUERY_NOT_OPEN, or INVALID_STATE_TRANSITION.',
  })
  closeQuery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('queryId', ParseUUIDPipe) queryId: string,
    @Req() req: Request,
  ): Promise<OfficerQueryDto> {
    return this.queries.close(
      user.userId,
      applicationId,
      queryId,
      req.ip ?? 'unknown',
    );
  }

  @Post('applications/:applicationId/recommendation')
  @Roles('SCRUTINY_OFFICER')
  @ApiOperation({
    summary:
      'Recommend approval or rejection to the Approving Authority (UNDER_SCRUTINY → RECOMMENDED_FOR_APPROVAL)',
    description:
      'A RECOMMENDATION with a mandatory reason — never a decision. The Approving Authority decides, in a later step; nothing here can approve or reject an application.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiCreatedResponse({ type: RecommendationDto })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiConflictResponse({ description: 'INVALID_STATE_TRANSITION.' })
  recommend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: RecommendDto,
    @Req() req: Request,
  ): Promise<RecommendationDto> {
    return this.scrutiny.recommend(
      user.userId,
      applicationId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  // ---- documents ----------------------------------------------------------

  @Get('applications/:applicationId/documents')
  @ApiOperation({
    summary:
      'The application’s documents (current versions; ?includeHistory for all)',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: [DocumentResponseDto] })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  documents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<DocumentResponseDto[]> {
    return this.workspace.listDocuments(
      user.userId,
      applicationId,
      query.includeHistory === true,
    );
  }

  @Get('applications/:applicationId/documents/:documentId')
  @ApiOperation({
    summary: 'One document version’s metadata, including its review',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOkResponse({ type: DocumentResponseDto })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  document(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<DocumentResponseDto> {
    return this.workspace.getDocument(user.userId, applicationId, documentId);
  }

  @Get('applications/:applicationId/documents/:documentId/versions')
  @ApiOperation({ summary: 'A document’s full version history, oldest first' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOkResponse({ type: [DocumentResponseDto] })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  documentVersions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<DocumentResponseDto[]> {
    return this.workspace.documentVersions(
      user.userId,
      applicationId,
      documentId,
    );
  }

  @Get('applications/:applicationId/documents/:documentId/download')
  @ApiOperation({
    summary: 'Download a document version',
    description:
      'Only through an application you are authorised for; only when the document has passed the security scan and is not rejected; integrity-checked; audited. Never exposes a storage path.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiOkResponse({
    description: 'The file, as an attachment.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiConflictResponse({ description: 'DOCUMENT_NOT_AVAILABLE.' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.workspace.downloadDocument(
      user.userId,
      applicationId,
      documentId,
      req.ip ?? 'unknown',
    );
    res.setHeader('Cache-Control', DOWNLOAD_CACHE_CONTROL);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.data, {
      type: file.mimeType,
      disposition: attachmentDisposition(file.filename),
      length: file.data.length,
    });
  }

  @Post('applications/:applicationId/documents/:documentId/review')
  @HttpCode(200)
  @Roles('SCRUTINY_OFFICER')
  @ApiOperation({
    summary: 'Verify or reject a document (FRD 22.1)',
    description:
      'The assigned Scrutiny Officer marks the CURRENT version of a scanned document Verified, or Rejected with a mandatory reason the applicant will see. Only while the application is under scrutiny. Recorded as an append-only review.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOkResponse({ type: DocumentResponseDto })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiConflictResponse({ description: 'DOCUMENT_NOT_REVIEWABLE.' })
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReviewDocumentDto,
    @Req() req: Request,
  ): Promise<DocumentResponseDto> {
    return this.scrutiny.reviewDocument(
      user.userId,
      applicationId,
      documentId,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
