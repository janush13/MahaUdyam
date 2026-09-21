import {
  Body,
  Controller,
  Get,
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
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import {
  CurrentEnterpriseAccess,
  EnterpriseAccessRequired,
} from '../enterprises/decorators/enterprise-access.decorator';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import {
  DOCUMENT_READ_LEVEL,
  DOCUMENT_WRITE_LEVEL,
  DOWNLOAD_CACHE_CONTROL,
  UPLOAD_FIELD,
} from './constants/document.constants';
import {
  DocumentRequirementStatusDto,
  DocumentResponseDto,
} from './dto/document-response.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import {
  ReplaceDocumentBodyDoc,
  ReplaceDocumentDto,
  UploadDocumentBodyDoc,
  UploadDocumentDto,
} from './dto/upload-document.dto';
import { DocumentsService, UploadedFileLike } from './documents.service';
import { attachmentDisposition } from './file-validation';
import { UploadErrorsInterceptor } from './upload-errors.interceptor';

const FORBIDDEN_DESCRIPTION =
  'FORBIDDEN_SCOPE — scope or project restriction insufficient.';

/**
 * Nested under the application (Blueprint 13.5's `/documents`, in this API's
 * enterprise -> project -> application form) so the existing
 * EnterpriseAccessGuard resolves the caller's relationship from
 * `:enterpriseId` and checks a project-restricted representative's list
 * against `:projectId`; the service then derives project -> application ->
 * document from the URL. That guard is the ONLY authorisation mechanism here.
 *
 * There is deliberately no route that deletes a document or writes a
 * status / scan state: documents are historical records, replaced (never
 * overwritten) by a new version, and their security state is set only by the
 * server.
 */
@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller(
  'enterprises/:enterpriseId/projects/:projectId/applications/:applicationId',
)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('documents')
  @EnterpriseAccessRequired(DOCUMENT_WRITE_LEVEL)
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor(UPLOAD_FIELD))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadDocumentBodyDoc })
  @ApiOperation({
    summary: 'Upload a document for a draft application',
    description:
      'multipart/form-data with a `file` part (PDF, JPEG or PNG) and optional `documentRequirementId` / `expiryDate` fields. The file is validated by its real content, scanned by the configured malware scanner (fail closed: an infected or unscannable file is rejected and never stored), stored under a server-generated key and attached to the application. Owner, uploader, status and scan state are set by the server. Requires PREPARE_SUBMIT or above for representatives; only while the application is a draft.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiCreatedResponse({ type: DocumentResponseDto })
  @ApiNotFoundResponse({
    description:
      'No live relationship to the enterprise, or no such project/application in it.',
  })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  @ApiConflictResponse({
    description:
      'ALREADY_SUBMITTED, or REQUIREMENT_ALREADY_HAS_DOCUMENT (replace instead).',
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
  ): Promise<DocumentResponseDto> {
    return this.documents.upload(
      access,
      projectId,
      applicationId,
      user.userId,
      file,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get('documents')
  @EnterpriseAccessRequired(DOCUMENT_READ_LEVEL)
  @ApiOperation({
    summary: "List an application's documents (current versions by default)",
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: [DocumentResponseDto] })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  list(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<DocumentResponseDto[]> {
    return this.documents.list(
      access,
      projectId,
      applicationId,
      query.includeHistory === true,
    );
  }

  @Get('document-requirements')
  @EnterpriseAccessRequired(DOCUMENT_READ_LEVEL)
  @ApiOperation({
    summary:
      'The document requirements configured for this approval, and whether each is satisfied',
    description:
      'Empty until a department configures requirements — nothing is assumed mandatory.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: [DocumentRequirementStatusDto] })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  requirements(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<DocumentRequirementStatusDto[]> {
    return this.documents.requirements(access, projectId, applicationId);
  }

  @Get('documents/:documentId')
  @EnterpriseAccessRequired(DOCUMENT_READ_LEVEL)
  @ApiOperation({ summary: "View one document version's metadata" })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOkResponse({ type: DocumentResponseDto })
  @ApiNotFoundResponse({
    description:
      'No such document on this application (an id from another application, project or enterprise is indistinguishable).',
  })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  get(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<DocumentResponseDto> {
    return this.documents.get(access, projectId, applicationId, documentId);
  }

  @Get('documents/:documentId/versions')
  @EnterpriseAccessRequired(DOCUMENT_READ_LEVEL)
  @ApiOperation({
    summary: 'The full version history of a document, oldest first',
    description:
      'Every version stays retrievable; replacing a document never removes an earlier one.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOkResponse({ type: [DocumentResponseDto] })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  versions(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<DocumentResponseDto[]> {
    return this.documents.versions(
      access,
      projectId,
      applicationId,
      documentId,
    );
  }

  @Get('documents/:documentId/download')
  @EnterpriseAccessRequired(DOCUMENT_READ_LEVEL)
  @ApiOperation({
    summary: 'Download a stored document version',
    description:
      'Served only through its application, only when the document has passed the security scan and is not rejected, and only after its SHA-256 integrity check. Never exposes a storage path.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiOkResponse({
    description: 'The file, as an attachment.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
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
    const file = await this.documents.download(
      access,
      projectId,
      applicationId,
      documentId,
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

  @Post('documents/:documentId/replace')
  @EnterpriseAccessRequired(DOCUMENT_WRITE_LEVEL)
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor(UPLOAD_FIELD))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ReplaceDocumentBodyDoc })
  @ApiOperation({
    summary: 'Replace a document with a new version (non-destructive)',
    description:
      'Uploads a new version (version + 1, same requirement and chain) that names the version it replaces. The previous version is kept and stays retrievable. Only the CURRENT version can be replaced; only while the application is a draft. Same validation and scanning as upload.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiCreatedResponse({ type: DocumentResponseDto })
  @ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
  @ApiConflictResponse({
    description: 'DOCUMENT_NOT_CURRENT or ALREADY_SUBMITTED.',
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
  ): Promise<DocumentResponseDto> {
    return this.documents.replace(
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
}
