import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  AttachEvidenceBodyDoc,
  AttachEvidenceDto,
  EvidenceDto,
  InspectionReportViewDto,
  RecordResultDto,
  RescheduleInspectionDto,
  ResultDto,
  SubmitReportDto,
  SubmitReportResultDto,
} from './dto/inspection-execution.dto';
import { InspectionDto } from './dto/inspection-response.dto';
import { InspectionExecutionService } from './inspection-execution.service';
import { InspectionReportService } from './inspection-report.service';

const NOT_FOUND =
  'No such inspection in your scope (nonexistent, another department’s, or another inspector’s — all indistinguishable).';
const FORBIDDEN =
  'INSUFFICIENT_ROLE — only the assigned Inspector can do this.';
const NOT_MODIFIABLE =
  'INSPECTION_NOT_MODIFIABLE (finished / cancelled, or scrutiny has finished), INSPECTION_NOT_SCHEDULED, or INSPECTION_ALREADY_CONFIRMED.';

/**
 * Inspection execution (Blueprint 13.7 `/inspections/:id`, `…/report`; FRD 4.4,
 * 24.2). The write routes are the ASSIGNED INSPECTOR's alone: `RolesGuard`
 * admits only INSPECTOR, and the service then requires that the caller is this
 * inspection's inspector in the application's department (anyone else gets the
 * same 404 as for a nonexistent id). A Scrutiny Officer, Department
 * Administrator or Approving Authority can READ results and evidence (the
 * inspection is part of their scrutiny record) but can perform none of these
 * actions. There is deliberately NO route that takes a status or a `completed`
 * flag: the inspection completes only by submitting its report.
 */
@ApiTags('Inspections')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('INSPECTOR')
@Controller('inspections/:inspectionId')
export class InspectionExecutionController {
  constructor(
    private readonly execution: InspectionExecutionService,
    private readonly reports: InspectionReportService,
  ) {}

  @Post('confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm the scheduled visit',
    description:
      'The assigned Inspector confirms the current date and time. Recorded as `confirmedAt`, not a status; withdrawn automatically if the date or the inspector changes.',
  })
  @ApiParam({ name: 'inspectionId', format: 'uuid' })
  @ApiOkResponse({ type: InspectionDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: NOT_MODIFIABLE })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('inspectionId', ParseUUIDPipe) inspectionId: string,
    @Req() req: Request,
  ): Promise<InspectionDto> {
    return this.execution.confirm(
      user.userId,
      inspectionId,
      req.ip ?? 'unknown',
    );
  }

  @Post('reschedule')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reschedule the visit',
    description:
      'The assigned Inspector moves a SCHEDULED visit to a new future date and time, with a reason (kept in the audit trail). Withdraws an earlier confirmation. Not available before the department has scheduled the inspection.',
  })
  @ApiParam({ name: 'inspectionId', format: 'uuid' })
  @ApiOkResponse({ type: InspectionDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_ERROR (a past date, or no change).',
  })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: NOT_MODIFIABLE })
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('inspectionId', ParseUUIDPipe) inspectionId: string,
    @Body() dto: RescheduleInspectionDto,
    @Req() req: Request,
  ): Promise<InspectionDto> {
    return this.execution.reschedule(
      user.userId,
      inspectionId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post('results')
  @ApiOperation({
    summary: 'Record a checklist result and finding',
    description:
      'One result for one item of the department’s checklist for this approval: a response, a finding (compliant / non-compliant / conditional), optional notes and optional evidence already attached to this inspection. Append-only: recording an item again adds a new result and leaves the earlier one on the record. Only while the inspection is SCHEDULED.',
  })
  @ApiParam({ name: 'inspectionId', format: 'uuid' })
  @ApiCreatedResponse({ type: ResultDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: NOT_MODIFIABLE })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_CHECKLIST_ITEM, or EVIDENCE_NOT_USABLE.',
  })
  recordResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param('inspectionId', ParseUUIDPipe) inspectionId: string,
    @Body() dto: RecordResultDto,
    @Req() req: Request,
  ): Promise<ResultDto> {
    return this.execution.recordResult(
      user.userId,
      inspectionId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post('evidence')
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor(UPLOAD_FIELD))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: AttachEvidenceBodyDoc })
  @ApiOperation({
    summary: 'Attach evidence (photo / document) to the inspection',
    description:
      'multipart/form-data with a `file` part (PDF, JPEG or PNG) and optional `capturedAt` / `caption`. The file goes through the SAME pipeline as every document (content validation, malware scan — fail closed, server-generated storage key); an infected or unscannable file is never stored. Owner, uploader, status and scan state are set by the server. No location is captured.',
  })
  @ApiParam({ name: 'inspectionId', format: 'uuid' })
  @ApiCreatedResponse({ type: EvidenceDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: NOT_MODIFIABLE })
  @ApiUnprocessableEntityResponse({
    description:
      'INVALID_FILENAME, MIME_TYPE_MISMATCH, CORRUPT_FILE or MALWARE_DETECTED. Also 400 FILE_REQUIRED / FILE_EMPTY, 413 FILE_TOO_LARGE, 415 UNSUPPORTED_TYPE.',
  })
  @ApiServiceUnavailableResponse({
    description: 'SCANNER_UNAVAILABLE or STORAGE_UNAVAILABLE (nothing stored).',
  })
  attachEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('inspectionId', ParseUUIDPipe) inspectionId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() dto: AttachEvidenceDto,
    @Req() req: Request,
  ): Promise<EvidenceDto> {
    return this.execution.attachEvidence(
      user.userId,
      inspectionId,
      file,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post('report')
  @ApiOperation({
    summary: 'Submit the inspection report (completes the inspection)',
    description:
      'The findings summary, the inspector’s observations and — for a NON_COMPLIANT finding — a corrective-action recommendation. Every item of the department’s checklist must already have a result. Writing the report is what completes the inspection (SCHEDULED → COMPLETED, in one transaction); a report is written once and never edited. The application’s own state is not changed by this step.',
  })
  @ApiParam({ name: 'inspectionId', format: 'uuid' })
  @ApiCreatedResponse({ type: SubmitReportResultDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_ERROR (e.g. no corrective action).',
  })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: NOT_MODIFIABLE })
  @ApiUnprocessableEntityResponse({ description: 'CHECKLIST_INCOMPLETE.' })
  submitReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('inspectionId', ParseUUIDPipe) inspectionId: string,
    @Body() dto: SubmitReportDto,
    @Req() req: Request,
  ): Promise<SubmitReportResultDto> {
    return this.execution.submitReport(
      user.userId,
      inspectionId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  // ---- reads: the assigned Inspector AND the officer roles that can see the
  // inspection ------------------------------------------------------------------

  @Get('report')
  @Roles('INSPECTOR', 'SCRUTINY_OFFICER', 'DEPT_ADMIN', 'APPROVING_AUTHORITY')
  @ApiOperation({
    summary: 'The checklist, recorded results, evidence and submitted report',
    description:
      'Each checklist item with its current result and every earlier result (nothing is overwritten), the evidence attached, and the report once submitted. Readable by the assigned Inspector and by the officer roles that can see the inspection.',
  })
  @ApiParam({ name: 'inspectionId', format: 'uuid' })
  @ApiOkResponse({ type: InspectionReportViewDto })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Param('inspectionId', ParseUUIDPipe) inspectionId: string,
  ): Promise<InspectionReportViewDto> {
    return this.reports.getReport(user.userId, inspectionId);
  }

  @Get('evidence/:evidenceId/download')
  @Roles('INSPECTOR', 'SCRUTINY_OFFICER', 'DEPT_ADMIN', 'APPROVING_AUTHORITY')
  @ApiOperation({
    summary: 'Download an evidence file',
    description:
      'Only a scanned, usable file is served; its bytes are re-checked against the stored SHA-256 and the download is audited. The storage key never leaves the server.',
  })
  @ApiParam({ name: 'inspectionId', format: 'uuid' })
  @ApiParam({ name: 'evidenceId', format: 'uuid' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiOkResponse({ description: 'The file, as an attachment.' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'DOCUMENT_NOT_AVAILABLE.' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('inspectionId', ParseUUIDPipe) inspectionId: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.reports.downloadEvidence(
      user.userId,
      inspectionId,
      evidenceId,
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
