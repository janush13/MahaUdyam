import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
import { APPLICATION_READ_LEVEL } from '../applications/constants/application.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import {
  DOWNLOAD_CACHE_CONTROL,
  UPLOAD_FIELD,
} from '../documents/constants/document.constants';
import { UploadedFileLike } from '../documents/documents.service';
import { attachmentDisposition } from '../documents/file-validation';
import { UploadErrorsInterceptor } from '../documents/upload-errors.interceptor';
import {
  CurrentEnterpriseAccess,
  EnterpriseAccessRequired,
} from '../enterprises/decorators/enterprise-access.decorator';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { CertificateService } from './certificate.service';
import { DecisionViewService } from './decision-view.service';
import { DecisionService } from './decision.service';
import {
  DecideDto,
  IssueCertificateBodyDoc,
  IssueCertificateDto,
} from './dto/decision-request.dto';
import {
  ApplicantDecisionViewDto,
  CertificateResultDto,
  DecisionResultDto,
} from './dto/decision-response.dto';

const NOT_FOUND_DESCRIPTION =
  'No such application in your department scope (also: a draft, another department’s, or one you cannot see — all indistinguishable).';
const FORBIDDEN_DESCRIPTION =
  'INSUFFICIENT_ROLE / INSUFFICIENT_PERMISSION — your role cannot do this.';
const ENTERPRISE_FORBIDDEN =
  'FORBIDDEN_SCOPE — the caller has no access to this enterprise or project.';
const ENTERPRISE_NOT_FOUND =
  'No such application in this project (an id from another project or enterprise is indistinguishable).';

function attachment(
  res: Response,
  file: { data: Buffer; filename: string; mimeType: string },
) {
  res.setHeader('Cache-Control', DOWNLOAD_CACHE_CONTROL);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return new StreamableFile(file.data, {
    type: file.mimeType,
    disposition: attachmentDisposition(file.filename),
    length: file.data.length,
  });
}

/**
 * The Approving Authority's statutory acts (FRD 4.5; TRD 28; Blueprint 20.2 /
 * 13.6 "/applications/:id/decision (Approving Authority only)"): the decision,
 * and the issuance of the approval certificate. Authorisation, in layers: JWT +
 * MFA (global), `RolesGuard` (APPROVING_AUTHORITY only - SYSTEM_ADMIN is never
 * in this list, Blueprint 20.3), then `OfficerAccessService` (the application's
 * OWN department, derived from its approval type, and the DECIDE /
 * ISSUE_CERTIFICATE capability). There is deliberately NO route that takes a
 * status: each act is a named action.
 */
@ApiTags('Officer decision')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('officer/applications/:applicationId')
export class OfficerDecisionController {
  constructor(
    private readonly decisions: DecisionService,
    private readonly certificates: CertificateService,
    private readonly views: DecisionViewService,
  ) {}

  @Post('decision')
  @Roles('APPROVING_AUTHORITY')
  @ApiOperation({
    summary:
      'Approve or reject (RECOMMENDED_FOR_APPROVAL → APPROVED | REJECTED)',
    description:
      'The statutory decision, with a mandatory recorded reason, by the Approving Authority of the application’s department. It answers the scrutiny recommendation on record (which it never alters) and may differ from it. Made once: a second or racing decision is refused. Approval does not by itself issue the certificate or start the compliance period — the certificate is issued next.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiCreatedResponse({ type: DecisionResultDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR (e.g. no reason).' })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiConflictResponse({
    description:
      'INVALID_STATE_TRANSITION, DECISION_ALREADY_RECORDED, RECOMMENDATION_NOT_FOUND, INSPECTION_OPEN or INSPECTION_REQUIRED.',
  })
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: DecideDto,
    @Req() req: Request,
  ): Promise<DecisionResultDto> {
    return this.decisions.decide(
      user.userId,
      applicationId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post('certificate')
  @Roles('APPROVING_AUTHORITY')
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor(UPLOAD_FIELD))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: IssueCertificateBodyDoc })
  @ApiOperation({
    summary:
      'Issue the approval certificate (APPROVED → CERTIFICATE_ISSUED → ACTIVE)',
    description:
      'multipart/form-data with a `file` part (the department’s certificate document: PDF, JPEG or PNG) and an optional `certificateNumber`. The file goes through the SAME pipeline as every document (content validation, malware scan — fail closed, server-generated storage key). In one transaction the certificate is recorded, the application becomes ACTIVE at the moment of issuance, and the department’s configured compliance obligations are created. The platform does not generate the certificate and imposes no format, numbering, validity period or e-signature: none is defined (TO BE VALIDATED).',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiCreatedResponse({ type: CertificateResultDto })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiConflictResponse({
    description: 'CERTIFICATE_NOT_ALLOWED or CERTIFICATE_ALREADY_ISSUED.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'INVALID_FILENAME, MIME_TYPE_MISMATCH, CORRUPT_FILE or MALWARE_DETECTED. Also 400 FILE_REQUIRED / FILE_EMPTY, 413 FILE_TOO_LARGE, 415 UNSUPPORTED_TYPE.',
  })
  @ApiServiceUnavailableResponse({
    description: 'SCANNER_UNAVAILABLE or STORAGE_UNAVAILABLE (nothing stored).',
  })
  issueCertificate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() dto: IssueCertificateDto,
    @Req() req: Request,
  ): Promise<CertificateResultDto> {
    return this.certificates.issue(
      user.userId,
      applicationId,
      file,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get('certificate/download')
  @Roles('SCRUTINY_OFFICER', 'DEPT_ADMIN', 'APPROVING_AUTHORITY')
  @ApiOperation({
    summary: 'Download the issued certificate',
    description:
      'Any officer role that can see the application. Only a scanned, usable file is served; its bytes are re-checked against the stored SHA-256 and the download is audited.',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiOkResponse({
    description: 'The file, as an attachment.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiNotFoundResponse({ description: NOT_FOUND_DESCRIPTION })
  @ApiConflictResponse({ description: 'DOCUMENT_NOT_AVAILABLE.' })
  async downloadCertificate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.views.downloadForOfficer(
      user.userId,
      applicationId,
      req.ip ?? 'unknown',
    );
    return attachment(res, file);
  }
}

/**
 * The applicant's read-only view of the department's decision and certificate
 * (FRD 18.1, 20.3). Nested under the enterprise / project like every other
 * applicant route, so `EnterpriseAccessGuard` is the only authorisation
 * mechanism: an owner, or a representative with at least view access to the
 * project. Nothing here writes.
 */
@ApiTags('Applications')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller(
  'enterprises/:enterpriseId/projects/:projectId/applications/:applicationId',
)
export class ApplicantDecisionController {
  constructor(private readonly views: DecisionViewService) {}

  @Get('decision')
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({
    summary: 'The department’s decision and certificate for my application',
    description:
      'The outcome and the reason the department recorded, and the certificate record once issued. Both are null until they exist. The scrutiny recommendation, officer identities, internal observations and audit information are never included.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: ApplicantDecisionViewDto })
  @ApiForbiddenResponse({ description: ENTERPRISE_FORBIDDEN })
  @ApiNotFoundResponse({ description: ENTERPRISE_NOT_FOUND })
  decision(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ApplicantDecisionViewDto> {
    return this.views.forApplicant(access, projectId, applicationId);
  }

  @Get('certificate/download')
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({
    summary: 'Download my application’s certificate',
    description:
      'Only once issued, only a scanned, usable file, integrity-checked and audited. Never exposes a storage path.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiOkResponse({
    description: 'The file, as an attachment.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiForbiddenResponse({ description: ENTERPRISE_FORBIDDEN })
  @ApiNotFoundResponse({
    description: 'No such application, or no certificate yet.',
  })
  @ApiConflictResponse({ description: 'DOCUMENT_NOT_AVAILABLE.' })
  async downloadCertificate(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.views.downloadForApplicant(
      access,
      projectId,
      applicationId,
      user.userId,
      req.ip ?? 'unknown',
    );
    return attachment(res, file);
  }
}
