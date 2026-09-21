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
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import {
  APPLICATION_READ_LEVEL,
  APPLICATION_WRITE_LEVEL,
} from '../applications/constants/application.constants';
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
import { ComplianceAdminService } from './compliance-admin.service';
import { ComplianceFulfilmentService } from './compliance-fulfilment.service';
import { ComplianceViewService } from './compliance-view.service';
import {
  CreateComplianceRequirementDto,
  ListComplianceQueryDto,
  ListRequirementsQueryDto,
  UpdateComplianceRequirementDto,
} from './dto/compliance-request.dto';
import {
  ApplicationComplianceDto,
  ComplianceObligationDto,
  ComplianceRequirementDto,
  EnterpriseComplianceListDto,
  OfficerApplicationComplianceDto,
  OfficerComplianceListDto,
} from './dto/compliance-response.dto';

const OFFICER_ROLES = [
  'SCRUTINY_OFFICER',
  'DEPT_ADMIN',
  'APPROVING_AUTHORITY',
] as const;

class FulfilComplianceBodyDoc {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    required: false,
    description:
      'The supporting document (PDF, JPEG or PNG). Required where the obligation requires evidence.',
  })
  [UPLOAD_FIELD]?: unknown;
}

/**
 * The applicant's compliance obligations (FRD 27; Blueprint 13.8), through the
 * same enterprise / project / representative access as every applicant route:
 * `EnterpriseAccessGuard` is the authorisation mechanism. Nothing here creates,
 * edits or re-dates an obligation, and no route takes a status: the only action
 * is fulfilling one.
 */
@ApiTags('Compliance')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller('enterprises/:enterpriseId')
export class ApplicantComplianceController {
  constructor(
    private readonly view: ComplianceViewService,
    private readonly fulfilment: ComplianceFulfilmentService,
  ) {}

  @Get('compliance')
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({
    summary: 'Compliance obligations across my enterprise',
    description:
      'Every obligation of every application of the enterprise (a project-restricted representative: their projects), earliest due date first. Filter by `status`.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiOkResponse({ type: EnterpriseComplianceListDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_SCOPE.' })
  list(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Query() query: ListComplianceQueryDto,
  ): Promise<EnterpriseComplianceListDto> {
    return this.view.forEnterprise(access, query);
  }

  @Get('projects/:projectId/applications/:applicationId/compliance')
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({
    summary: 'Compliance obligations of my application',
    description:
      'Each occurrence of each obligation is its own item, as it was created (a later change to the department’s configuration never alters it). An approval with no configured obligations shows none, with a note (FRD 27.2).',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: ApplicationComplianceDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_SCOPE.' })
  @ApiNotFoundResponse({ description: 'No such application in this project.' })
  forApplication(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ApplicationComplianceDto> {
    return this.view.forApplication(access, projectId, applicationId);
  }

  @Get('projects/:projectId/applications/:applicationId/compliance/:recordId')
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({ summary: 'One compliance obligation' })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiOkResponse({ type: ComplianceObligationDto })
  @ApiNotFoundResponse({
    description: 'Nonexistent, or not this application’s.',
  })
  get(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ): Promise<ComplianceObligationDto> {
    return this.view.get(access, projectId, applicationId, recordId);
  }

  @Post(
    'projects/:projectId/applications/:applicationId/compliance/:recordId/fulfil',
  )
  @EnterpriseAccessRequired(APPLICATION_WRITE_LEVEL)
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor(UPLOAD_FIELD))
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: FulfilComplianceBodyDoc })
  @ApiOperation({
    summary: 'Fulfil an obligation, with its supporting document',
    description:
      'multipart/form-data with an optional `file` part, REQUIRED where the obligation requires evidence (refused before anything is scanned or stored). The file goes through the SAME pipeline as every document (content validation, malware scan — fail closed, server-generated storage key). Submitting is what fulfils it: the requirements define no officer review. Permanent; may be done early or late. A View Only representative cannot.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiOkResponse({ type: ComplianceObligationDto })
  @ApiBadRequestResponse({
    description: 'COMPLIANCE_EVIDENCE_REQUIRED, or FILE_REQUIRED / FILE_EMPTY.',
  })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_SCOPE.' })
  @ApiNotFoundResponse({
    description: 'Nonexistent, or not this application’s.',
  })
  @ApiConflictResponse({ description: 'COMPLIANCE_ALREADY_FULFILLED.' })
  @ApiUnprocessableEntityResponse({
    description:
      'INVALID_FILENAME, MIME_TYPE_MISMATCH, CORRUPT_FILE or MALWARE_DETECTED (413 / 415 for size / type).',
  })
  @ApiServiceUnavailableResponse({
    description: 'SCANNER_UNAVAILABLE or STORAGE_UNAVAILABLE (nothing stored).',
  })
  fulfil(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ComplianceObligationDto> {
    return this.fulfilment.fulfil(
      access,
      projectId,
      applicationId,
      recordId,
      user.userId,
      file,
      req.ip ?? 'unknown',
    );
  }

  @Get(
    'projects/:projectId/applications/:applicationId/compliance/:recordId/evidence',
  )
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({
    summary: 'Download the supporting document of a fulfilled obligation',
    description:
      'Only after the security scan and only after the SHA-256 integrity check, through the same path as every document download. Never exposes a storage path.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({
    description: 'No such obligation, or it has no evidence.',
  })
  @ApiConflictResponse({ description: 'DOCUMENT_NOT_AVAILABLE.' })
  async evidence(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.view.evidenceForApplicant(
      access,
      projectId,
      applicationId,
      recordId,
      user.userId,
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
}

/** The officer's read-only compliance views (TRD 14 dashboard; TRD API
 * `/applications/{id}/compliance` "Applicant/Officer"). No route anywhere sets,
 * moves or clears an obligation for an officer: the requirements define no
 * officer action on one. */
@ApiTags('Compliance')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(...OFFICER_ROLES)
@Controller('officer')
export class OfficerComplianceController {
  constructor(private readonly view: ComplianceViewService) {}

  @Get('compliance')
  @ApiOperation({
    summary: 'Compliance obligations of the applications I can see',
    description:
      'Exactly the applications your role can already see (a Scrutiny Officer: those assigned to them; a Department Administrator: the department; an Approving Authority: those awaiting a decision), earliest due date first. Filter by `status`.',
  })
  @ApiOkResponse({ type: OfficerComplianceListDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListComplianceQueryDto,
  ): Promise<OfficerComplianceListDto> {
    return this.view.listForOfficer(user.userId, query);
  }

  @Get('applications/:applicationId/compliance')
  @ApiOperation({ summary: 'The compliance obligations of one application' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: OfficerApplicationComplianceDto })
  @ApiNotFoundResponse({
    description:
      'Nonexistent, a draft, or outside your department / assignment scope — all indistinguishable.',
  })
  forApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<OfficerApplicationComplianceDto> {
    return this.view.forOfficerApplication(user.userId, applicationId);
  }

  @Get('applications/:applicationId/compliance/:recordId/evidence')
  @ApiOperation({
    summary: 'Download the supporting document of a fulfilled obligation',
    description:
      'Same download path and checks as every document (scanned, integrity-checked, audited).',
  })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({
    description: 'As for the application view, or no evidence.',
  })
  async evidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.view.evidenceForOfficer(
      user.userId,
      applicationId,
      recordId,
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
}

/**
 * Compliance configuration (FRD 27.2 / TRD 14; FRD 21). A department's
 * obligations are the DEPARTMENT ADMINISTRATOR's, for the approval types of
 * their own department, and nobody else's - not a System Administrator's (FRD
 * 35.2). Nothing is seeded and nothing is inferred.
 */
@ApiTags('Compliance')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('DEPT_ADMIN')
@Controller('admin/compliance/requirements')
export class ComplianceAdminController {
  constructor(private readonly admin: ComplianceAdminService) {}

  @Get()
  @ApiOperation({ summary: 'The compliance requirements of my department' })
  @ApiOkResponse({ type: [ComplianceRequirementDto] })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListRequirementsQueryDto,
  ): Promise<ComplianceRequirementDto[]> {
    return this.admin.list(user.userId, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Configure a compliance obligation for an approval type',
    description:
      'A plain-language requirement, its frequency (ONE_TIME / MONTHLY / ANNUAL), whether evidence is required, and — only if the department has one — the first due date as a number of days. Omitted, the due date is "not yet configured". Applies to obligations created afterwards.',
  })
  @ApiCreatedResponse({ type: ComplianceRequirementDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR.' })
  @ApiNotFoundResponse({
    description:
      'Nonexistent, or an approval type of a department you do not administer.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateComplianceRequirementDto,
    @Req() req: Request,
  ): Promise<ComplianceRequirementDto> {
    return this.admin.create(user.userId, dto, req.ip ?? 'unknown');
  }

  @Put(':requirementId')
  @ApiOperation({
    summary: 'Change a compliance requirement',
    description:
      'Bumps its version. Obligations already created keep the version they were created under; `isActive: false` stops new occurrences. Audited with before and after. There is no delete.',
  })
  @ApiParam({ name: 'requirementId', format: 'uuid' })
  @ApiOkResponse({ type: ComplianceRequirementDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR (or no change).' })
  @ApiNotFoundResponse({
    description: 'Nonexistent, or a department you do not administer.',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @Body() dto: UpdateComplianceRequirementDto,
    @Req() req: Request,
  ): Promise<ComplianceRequirementDto> {
    return this.admin.update(
      user.userId,
      requirementId,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
