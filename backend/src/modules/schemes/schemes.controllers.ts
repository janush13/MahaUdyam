import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import {
  DOWNLOAD_CACHE_CONTROL,
  UPLOAD_FIELD,
} from '../documents/constants/document.constants';
import { UploadedFileLike } from '../documents/documents.service';
import { ListDocumentsQueryDto } from '../documents/dto/list-documents-query.dto';
import {
  ReplaceDocumentBodyDoc,
  ReplaceDocumentDto,
  UploadDocumentBodyDoc,
  UploadDocumentDto,
} from '../documents/dto/upload-document.dto';
import { attachmentDisposition } from '../documents/file-validation';
import { UploadErrorsInterceptor } from '../documents/upload-errors.interceptor';
import {
  CurrentEnterpriseAccess,
  EnterpriseAccessRequired,
} from '../enterprises/decorators/enterprise-access.decorator';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { ReviewDocumentDto } from '../officer/dto/officer-request.dto';
import {
  BrowseSchemesQueryDto,
  DecideSchemeApplicationDto,
  ListOfficerSchemeApplicationsQueryDto,
  ListRecommendationsQueryDto,
  ListSchemeApplicationsQueryDto,
} from './dto/scheme-request.dto';
import {
  OfficerSchemeApplicationDto,
  OfficerSchemeApplicationListDto,
  SchemeApplicationDto,
  SchemeDocumentDto,
  SchemeDto,
  SchemeEvidenceRequirementStatusDto,
  SchemeListDto,
  SchemeRecommendationsDto,
} from './dto/scheme-response.dto';
import { SchemeApplicationsService } from './scheme-applications.service';
import { SchemeBrowseService } from './scheme-browse.service';
import { SchemeEvidenceService } from './scheme-evidence.service';
import { SchemeOfficerService } from './scheme-officer.service';
import { SchemeRecommendationService } from './scheme-recommendation.service';
import { SCHEME_READ_LEVEL, SCHEME_WRITE_LEVEL } from './scheme.constants';

const FORBIDDEN_DESCRIPTION =
  'FORBIDDEN_SCOPE — scope or project restriction insufficient.';

function asAttachment(
  res: Response,
  file: { data: Buffer; filename: string; mimeType: string },
): StreamableFile {
  res.setHeader('Cache-Control', DOWNLOAD_CACHE_CONTROL);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return new StreamableFile(file.data, {
    type: file.mimeType,
    disposition: attachmentDisposition(file.filename),
    length: file.data.length,
  });
}

/**
 * The public scheme catalogue (FRD 6 / 29.1 / 29.2, Blueprint 13.9 `GET
 * /schemes`, "Public/Applicant"): browse, search and filter, no account needed.
 * Shows only PUBLISHED, active schemes and none of the internal configuration.
 */
@ApiTags('Schemes')
@Controller('schemes')
export class SchemesPublicController {
  constructor(private readonly browse: SchemeBrowseService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Browse the published scheme catalogue',
    description:
      'Keyword search and filters by sector, location (district), enterprise size and benefit type (FRD 29.1). A scheme that lists no sectors / districts / sizes is not restricted on that facet and stays listed. Each scheme shows its department, eligibility criteria in plain language, benefits, required documents and application deadline (if any). Public: no account is needed. Nothing here says whether anyone is eligible.',
  })
  @ApiOkResponse({ type: SchemeListDto })
  list(@Query() query: BrowseSchemesQueryDto): Promise<SchemeListDto> {
    return this.browse.list(query);
  }

  @Public()
  @Get(':schemeId')
  @ApiOperation({ summary: 'One published scheme' })
  @ApiParam({ name: 'schemeId', format: 'uuid' })
  @ApiOkResponse({ type: SchemeDto })
  @ApiNotFoundResponse({
    description:
      'No such scheme - or a draft / inactive one, which is indistinguishable.',
  })
  get(@Param('schemeId', ParseUUIDPipe) schemeId: string): Promise<SchemeDto> {
    return this.browse.get(schemeId);
  }
}

/**
 * The applicant's side: recommendations, applying, tracking and evidence
 * (FRD 29.3 - 29.5, Blueprint 13.9), nested under the enterprise / project
 * (Blueprint's `/schemes/recommendations?project_id=` and `/schemes/:id/apply`, in
 * this API's enterprise-nested form like Steps 6-15) so the existing
 * EnterpriseAccessGuard resolves the caller's relationship from `:enterpriseId`
 * and checks a project-restricted representative's list against `:projectId`.
 * That guard is the ONLY authorisation mechanism here.
 *
 * There is deliberately no route that writes a status: a scheme application moves
 * only through the Scheme Officer's explicit actions.
 */
@ApiTags('Scheme applications')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller('enterprises/:enterpriseId')
export class ApplicantSchemesController {
  constructor(
    private readonly recommendations: SchemeRecommendationService,
    private readonly applications: SchemeApplicationsService,
    private readonly evidence: SchemeEvidenceService,
  ) {}

  @Get('projects/:projectId/scheme-recommendations')
  @EnterpriseAccessRequired(SCHEME_READ_LEVEL)
  @ApiOperation({
    summary: 'Schemes this project may be eligible for (a recommendation)',
    description:
      'A ranked list from the deterministic eligibility rules the departments configured, evaluated on the project’s own recorded details, each with its plain-language explanation and the mandatory notice: "You may be eligible for this scheme based on your project details. This is not an official eligibility determination — apply to receive a decision from the administering department." Nothing is created or decided; applying is a separate step.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOkResponse({ type: SchemeRecommendationsDto })
  @ApiNotFoundResponse({
    description:
      'No live relationship to the enterprise, or no such project in it.',
  })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  recommend(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListRecommendationsQueryDto,
  ): Promise<SchemeRecommendationsDto> {
    return this.recommendations.recommend(access, projectId, query);
  }

  @Post('projects/:projectId/schemes/:schemeId/apply')
  @EnterpriseAccessRequired(SCHEME_WRITE_LEVEL)
  @ApiOperation({
    summary: 'Apply for a scheme',
    description:
      'Creates the application in the documented first status (APPLIED) with a reference number. The body is empty: no status, enterprise, project or owner is accepted. The scheme need not have been recommended. Requires PREPARE_SUBMIT or above for representatives; a representative restricted to specific projects can act only on those. One live application per scheme per project; refused after the scheme’s deadline, if it has one.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'schemeId', format: 'uuid' })
  @ApiCreatedResponse({ type: SchemeApplicationDto })
  @ApiNotFoundResponse({
    description:
      'No live relationship to the enterprise, no such project in it, or no such (published, active) scheme.',
  })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  @ApiConflictResponse({
    description:
      'SCHEME_APPLICATION_ALREADY_EXISTS or SCHEME_APPLICATION_CLOSED.',
  })
  apply(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SchemeApplicationDto> {
    return this.applications.apply(
      access,
      projectId,
      schemeId,
      user.userId,
      req.ip ?? 'unknown',
    );
  }

  @Get('scheme-applications')
  @EnterpriseAccessRequired(SCHEME_READ_LEVEL)
  @ApiOperation({
    summary: "List the enterprise's scheme applications across its projects",
    description:
      'A representative restricted to specific projects sees only those projects’ applications.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiOkResponse({ type: [SchemeApplicationDto] })
  listForEnterprise(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Query() query: ListSchemeApplicationsQueryDto,
  ): Promise<SchemeApplicationDto[]> {
    return this.applications.listForEnterprise(access, query);
  }

  @Get('projects/:projectId/scheme-applications')
  @EnterpriseAccessRequired(SCHEME_READ_LEVEL)
  @ApiOperation({
    summary: "List a project's scheme applications, newest first",
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOkResponse({ type: [SchemeApplicationDto] })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  listForProject(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListSchemeApplicationsQueryDto,
  ): Promise<SchemeApplicationDto[]> {
    return this.applications.listForProject(access, projectId, query);
  }

  @Get('projects/:projectId/scheme-applications/:applicationId')
  @EnterpriseAccessRequired(SCHEME_READ_LEVEL)
  @ApiOperation({
    summary: 'Track a scheme application',
    description:
      'Reference number, status, timeline and the decision with its reason (FRD 29.5), plus what the system suggested when the applicant applied (a recommendation, never a determination). No officer is identified.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: SchemeApplicationDto })
  @ApiNotFoundResponse({
    description: 'Nonexistent, or not this project’s / enterprise’s.',
  })
  get(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<SchemeApplicationDto> {
    return this.applications.get(access, projectId, applicationId);
  }

  // ---- evidence ------------------------------------------------------------------

  @Get(
    'projects/:projectId/scheme-applications/:applicationId/document-requirements',
  )
  @EnterpriseAccessRequired(SCHEME_READ_LEVEL)
  @ApiOperation({
    summary:
      'The documents this scheme requires, and whether each is satisfied',
    description:
      'Empty until the department configures requirements - nothing is assumed mandatory.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: [SchemeEvidenceRequirementStatusDto] })
  requirements(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<SchemeEvidenceRequirementStatusDto[]> {
    return this.evidence.requirements(access, projectId, applicationId);
  }

  @Get('projects/:projectId/scheme-applications/:applicationId/documents')
  @EnterpriseAccessRequired(SCHEME_READ_LEVEL)
  @ApiOperation({
    summary: "List an application's evidence (current versions by default)",
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: [SchemeDocumentDto] })
  listDocuments(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<SchemeDocumentDto[]> {
    return this.evidence.list(
      access,
      projectId,
      applicationId,
      query.includeHistory === true,
    );
  }

  @Post('projects/:projectId/scheme-applications/:applicationId/documents')
  @EnterpriseAccessRequired(SCHEME_WRITE_LEVEL)
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor(UPLOAD_FIELD))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadDocumentBodyDoc })
  @ApiOperation({
    summary: 'Upload supporting evidence for a scheme application',
    description:
      'multipart/form-data with a `file` part (PDF, JPEG or PNG) and optional `documentRequirementId` (one of THIS scheme’s requirements) / `expiryDate` fields. The same pipeline as every document: validated by its real content, scanned by the configured malware scanner (fail closed: an infected or unscannable file is rejected and never stored), stored under a server-generated key. Owner, uploader, status and scan state are set by the server. Possible while the application is APPLIED or UNDER_REVIEW.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiCreatedResponse({ type: SchemeDocumentDto })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  @ApiConflictResponse({
    description:
      'SCHEME_EVIDENCE_LOCKED, or REQUIREMENT_ALREADY_HAS_DOCUMENT (replace instead).',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'INVALID_FILENAME, MIME_TYPE_MISMATCH, CORRUPT_FILE, MALWARE_DETECTED or DOCUMENT_REQUIREMENT_MISMATCH. Also 400 FILE_REQUIRED / FILE_EMPTY, 413 FILE_TOO_LARGE, 415 UNSUPPORTED_TYPE.',
  })
  @ApiServiceUnavailableResponse({
    description: 'SCANNER_UNAVAILABLE or STORAGE_UNAVAILABLE (nothing stored).',
  })
  upload(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() dto: UploadDocumentDto,
    @Req() req: Request,
  ): Promise<SchemeDocumentDto> {
    return this.evidence.upload(
      access,
      projectId,
      applicationId,
      user.userId,
      file,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post(
    'projects/:projectId/scheme-applications/:applicationId/documents/:documentId/replace',
  )
  @EnterpriseAccessRequired(SCHEME_WRITE_LEVEL)
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor(UPLOAD_FIELD))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ReplaceDocumentBodyDoc })
  @ApiOperation({
    summary: 'Replace evidence with a new version (non-destructive)',
    description:
      'A new version (version + 1, same requirement and chain) that names the version it replaces; the previous version is kept. Only the CURRENT version can be replaced, while the application is APPLIED or UNDER_REVIEW.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiCreatedResponse({ type: SchemeDocumentDto })
  @ApiConflictResponse({
    description: 'DOCUMENT_NOT_CURRENT or SCHEME_EVIDENCE_LOCKED.',
  })
  replace(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() dto: ReplaceDocumentDto,
    @Req() req: Request,
  ): Promise<SchemeDocumentDto> {
    return this.evidence.replace(
      access,
      projectId,
      applicationId,
      documentId,
      user.userId,
      file,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get(
    'projects/:projectId/scheme-applications/:applicationId/documents/:documentId/download',
  )
  @EnterpriseAccessRequired(SCHEME_READ_LEVEL)
  @ApiOperation({
    summary: 'Download a stored evidence version',
    description:
      'Only after the security scan and the SHA-256 integrity check, through the same path as every document download. Never exposes a storage path.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiConflictResponse({ description: 'DOCUMENT_NOT_AVAILABLE.' })
  async download(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return asAttachment(
      res,
      await this.evidence.download(
        access,
        projectId,
        applicationId,
        documentId,
        user.userId,
        req.ip ?? 'unknown',
      ),
    );
  }
}

/**
 * The Scheme Officer's queue and actions (FRD 4.7 / 34, TRD 28). Department-scoped
 * by the scheme's own department, resolved server-side; every other role is
 * refused. There is no status endpoint: `start-review`, `decision` and
 * `disburse` are the only ways a status changes, each along the documented flow.
 */
@ApiTags('Scheme officer')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('SCHEME_OFFICER')
@Controller('scheme-officer/scheme-applications')
export class SchemeOfficerApplicationsController {
  constructor(
    private readonly officer: SchemeOfficerService,
    private readonly evidence: SchemeEvidenceService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Scheme applications of the departments I am a Scheme Officer for',
    description:
      'Oldest first. Filter by status, scheme, or a search over the reference number / enterprise / project.',
  })
  @ApiOkResponse({ type: OfficerSchemeApplicationListDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOfficerSchemeApplicationsQueryDto,
  ): Promise<OfficerSchemeApplicationListDto> {
    return this.officer.list(user.userId, query);
  }

  @Get(':applicationId')
  @ApiOperation({
    summary:
      'One scheme application, with the project details it was suggested on',
    description:
      'Includes the system’s recommendation recorded when the applicant applied - advice only; your decision is the determination.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: OfficerSchemeApplicationDto })
  @ApiNotFoundResponse({
    description: 'Nonexistent, or another department’s - indistinguishable.',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<OfficerSchemeApplicationDto> {
    return this.officer.get(user.userId, applicationId);
  }

  @Post(':applicationId/start-review')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start reviewing an application (Applied -> Under Review)',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: OfficerSchemeApplicationDto })
  @ApiConflictResponse({ description: 'INVALID_STATE_TRANSITION.' })
  startReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<OfficerSchemeApplicationDto> {
    return this.officer.startReview(
      user.userId,
      applicationId,
      req.ip ?? 'unknown',
    );
  }

  @Post(':applicationId/decision')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record the decision (Under Review -> Approved / Rejected)',
    description:
      'Your eligibility determination, with a mandatory reason the applicant sees. Approving requires usable evidence for every MANDATORY document the scheme requires; rejecting never does. No status, user or time is accepted from the client.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: OfficerSchemeApplicationDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_ERROR (a reason is required).',
  })
  @ApiConflictResponse({
    description: 'INVALID_STATE_TRANSITION or SCHEME_EVIDENCE_INCOMPLETE.',
  })
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: DecideSchemeApplicationDto,
    @Req() req: Request,
  ): Promise<OfficerSchemeApplicationDto> {
    return this.officer.decide(
      user.userId,
      applicationId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post(':applicationId/disburse')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record the benefit as disbursed (Approved -> Disbursed)',
    description:
      'A status marker only (TRD 15 "Disbursed"): no amount, payment or bank detail is recorded or accepted - the platform integrates no payment flow.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: OfficerSchemeApplicationDto })
  @ApiConflictResponse({ description: 'INVALID_STATE_TRANSITION.' })
  disburse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<OfficerSchemeApplicationDto> {
    return this.officer.disburse(
      user.userId,
      applicationId,
      req.ip ?? 'unknown',
    );
  }

  // ---- evidence ------------------------------------------------------------------

  @Get(':applicationId/document-requirements')
  @ApiOperation({
    summary: 'The scheme’s required documents and whether each is satisfied',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: [SchemeEvidenceRequirementStatusDto] })
  requirements(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<SchemeEvidenceRequirementStatusDto[]> {
    return this.evidence.requirementsForOfficer(user.userId, applicationId);
  }

  @Get(':applicationId/documents')
  @ApiOperation({ summary: 'The application’s evidence' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: [SchemeDocumentDto] })
  listDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<SchemeDocumentDto[]> {
    return this.evidence.listForOfficer(
      user.userId,
      applicationId,
      query.includeHistory === true,
    );
  }

  @Get(':applicationId/documents/:documentId/download')
  @ApiOperation({
    summary: 'Download an evidence version',
    description:
      'Same download path and checks as every document (scanned, integrity-checked, audited).',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return asAttachment(
      res,
      await this.evidence.downloadForOfficer(
        user.userId,
        applicationId,
        documentId,
        req.ip ?? 'unknown',
      ),
    );
  }

  @Post(':applicationId/documents/:documentId/review')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify or reject an evidence document',
    description:
      'The CURRENT version of a scanned document awaiting review, while the application is UNDER_REVIEW. A rejection needs a reason, which the applicant sees.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOkResponse({ type: SchemeDocumentDto })
  @ApiConflictResponse({ description: 'DOCUMENT_NOT_REVIEWABLE.' })
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReviewDocumentDto,
    @Req() req: Request,
  ): Promise<SchemeDocumentDto> {
    return this.evidence.review(
      user.userId,
      applicationId,
      documentId,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
