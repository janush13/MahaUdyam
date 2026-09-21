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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import {
  AddSchemeRuleDto,
  CreateSchemeDocumentRequirementDto,
  CreateSchemeDto,
  ListSchemesAdminQueryDto,
  SetSchemeActiveDto,
  UpdateSchemeDocumentRequirementDto,
  UpdateSchemeDto,
} from './dto/scheme-request.dto';
import {
  SchemeAdminDto,
  SchemeAdminListDto,
  SchemeDocumentRequirementDto,
  SchemeRuleDto,
} from './dto/scheme-response.dto';
import { SchemeCatalogueService } from './scheme-catalogue.service';

/**
 * Maintaining the scheme catalogue (FRD 4.7 / 34, TRD 15 / 28 "Scheme Officer -
 * Create/Edit (catalogue), Configure (catalogue)"). Three role families reach it,
 * each with the least it needs, decided per scheme and department by the
 * service (never here):
 *  - SCHEME_OFFICER of the department: drafts and edits entries, rule versions
 *    and required documents; withdraws entries.
 *  - the configured publisher role(s) (FRD 34 leaves the owner TO BE VALIDATED -
 *    SCHEME_PUBLISHER_ROLES): view and publish, and withdraw.
 * Never a System Administrator (FRD 35.2). Nothing is seeded; every value is the
 * department's own.
 */
@ApiTags('Scheme catalogue administration')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('SCHEME_OFFICER', 'DEPT_ADMIN', 'LEGAL_COMPLIANCE')
@Controller('scheme-officer/schemes')
export class SchemeCatalogueController {
  constructor(private readonly catalogue: SchemeCatalogueService) {}

  @Get()
  @ApiOperation({
    summary: 'The catalogue entries I can see (drafts included)',
    description:
      'Each carries what YOU may do with it (`capabilities`). A Scheme Officer sees their department’s entries; a publisher role sees the entries it can publish.',
  })
  @ApiOkResponse({ type: SchemeAdminListDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSchemesAdminQueryDto,
  ): Promise<SchemeAdminListDto> {
    return this.catalogue.list(user.userId, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Draft a scheme catalogue entry',
    description:
      'Creates a DRAFT (never visible to applicants) in a department you are a Scheme Officer of. The status, version, creator and publisher are the server’s. Nothing is defaulted: no benefit, threshold or deadline exists until you supply it.',
  })
  @ApiCreatedResponse({ type: SchemeAdminDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR.' })
  @ApiNotFoundResponse({
    description:
      'Nonexistent, or a department you are not a Scheme Officer of.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSchemeDto,
    @Req() req: Request,
  ): Promise<SchemeAdminDto> {
    return this.catalogue.create(user.userId, dto, req.ip ?? 'unknown');
  }

  @Get(':schemeId')
  @ApiOperation({ summary: 'One catalogue entry with its rule versions' })
  @ApiParam({ name: 'schemeId', format: 'uuid' })
  @ApiOkResponse({ type: SchemeAdminDto })
  @ApiNotFoundResponse({
    description:
      'Nonexistent, or outside your departments - indistinguishable.',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
  ): Promise<SchemeAdminDto> {
    return this.catalogue.get(user.userId, schemeId);
  }

  @Put(':schemeId')
  @ApiOperation({
    summary: 'Edit a DRAFT entry',
    description:
      'Bumps its version. A published scheme is frozen: return it to draft first (409 SCHEME_NOT_EDITABLE). Audited with before and after.',
  })
  @ApiParam({ name: 'schemeId', format: 'uuid' })
  @ApiOkResponse({ type: SchemeAdminDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR (or no change).' })
  @ApiForbiddenResponse({ description: 'INSUFFICIENT_PERMISSION.' })
  @ApiConflictResponse({ description: 'SCHEME_NOT_EDITABLE.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Body() dto: UpdateSchemeDto,
    @Req() req: Request,
  ): Promise<SchemeAdminDto> {
    return this.catalogue.update(
      user.userId,
      schemeId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post(':schemeId/rules')
  @ApiOperation({
    summary: 'Add a new version of the eligibility rule (draft only)',
    description:
      'A new immutable version; the highest effective one applies (history is never rewritten). Validated against the closed condition grammar shared with approval discovery: an invalid rule is refused. `isActive: false` retires the rule (the scheme is then not recommended). Only to a draft: what is published is what was approved.',
  })
  @ApiParam({ name: 'schemeId', format: 'uuid' })
  @ApiCreatedResponse({ type: SchemeRuleDto })
  @ApiBadRequestResponse({
    description:
      'INVALID_RULE_DEFINITION, INVALID_EFFECTIVE_DATES or VALIDATION_ERROR.',
  })
  @ApiConflictResponse({ description: 'SCHEME_NOT_EDITABLE.' })
  addRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Body() dto: AddSchemeRuleDto,
    @Req() req: Request,
  ): Promise<SchemeRuleDto> {
    return this.catalogue.addRule(
      user.userId,
      schemeId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post(':schemeId/document-requirements')
  @ApiOperation({
    summary: 'Add a required document (draft only)',
  })
  @ApiParam({ name: 'schemeId', format: 'uuid' })
  @ApiCreatedResponse({ type: SchemeDocumentRequirementDto })
  @ApiConflictResponse({ description: 'SCHEME_NOT_EDITABLE.' })
  addRequirement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Body() dto: CreateSchemeDocumentRequirementDto,
    @Req() req: Request,
  ): Promise<SchemeDocumentRequirementDto> {
    return this.catalogue.addRequirement(
      user.userId,
      schemeId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Put(':schemeId/document-requirements/:requirementId')
  @ApiOperation({ summary: 'Change a required document (draft only)' })
  @ApiParam({ name: 'schemeId', format: 'uuid' })
  @ApiParam({ name: 'requirementId', format: 'uuid' })
  @ApiOkResponse({ type: SchemeDocumentRequirementDto })
  @ApiConflictResponse({ description: 'SCHEME_NOT_EDITABLE.' })
  updateRequirement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @Body() dto: UpdateSchemeDocumentRequirementDto,
    @Req() req: Request,
  ): Promise<SchemeDocumentRequirementDto> {
    return this.catalogue.updateRequirement(
      user.userId,
      schemeId,
      requirementId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Delete(':schemeId/document-requirements/:requirementId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove a required document (draft only, and only if unused)',
  })
  @ApiParam({ name: 'schemeId', format: 'uuid' })
  @ApiParam({ name: 'requirementId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiConflictResponse({
    description: 'SCHEME_NOT_EDITABLE or SCHEME_REQUIREMENT_IN_USE.',
  })
  async removeRequirement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.catalogue.removeRequirement(
      user.userId,
      schemeId,
      requirementId,
      req.ip ?? 'unknown',
    );
  }

  @Post(':schemeId/publish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Publish a drafted scheme (make it visible to applicants)',
    description:
      'The publish / approval step of FRD 34, by a configured publisher role of the scheme’s department (SCHEME_PUBLISHER_ROLES; default Department Administrator). The drafting Scheme Officer cannot publish unless that role is configured as a publisher. What is published - content, rule versions, required documents - is frozen.',
  })
  @ApiParam({ name: 'schemeId', format: 'uuid' })
  @ApiOkResponse({ type: SchemeAdminDto })
  @ApiForbiddenResponse({ description: 'INSUFFICIENT_PERMISSION.' })
  @ApiConflictResponse({ description: 'SCHEME_ALREADY_PUBLISHED.' })
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Req() req: Request,
  ): Promise<SchemeAdminDto> {
    return this.catalogue.publish(user.userId, schemeId, req.ip ?? 'unknown');
  }

  @Post(':schemeId/unpublish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Return a published scheme to draft',
    description:
      'Hides it from applicants and makes it editable again; it must be published again to reappear. Existing applications are unaffected (they keep the entry they were made on).',
  })
  @ApiParam({ name: 'schemeId', format: 'uuid' })
  @ApiOkResponse({ type: SchemeAdminDto })
  @ApiConflictResponse({ description: 'SCHEME_NOT_PUBLISHED.' })
  unpublish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Req() req: Request,
  ): Promise<SchemeAdminDto> {
    return this.catalogue.unpublish(user.userId, schemeId, req.ip ?? 'unknown');
  }

  @Put(':schemeId/active')
  @ApiOperation({
    summary: 'Activate or deactivate a scheme',
    description:
      'A deactivated scheme is hidden and takes no new applications; its published content is untouched and existing applications continue.',
  })
  @ApiParam({ name: 'schemeId', format: 'uuid' })
  @ApiOkResponse({ type: SchemeAdminDto })
  @ApiBadRequestResponse({ description: 'The request changes nothing.' })
  setActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Body() dto: SetSchemeActiveDto,
    @Req() req: Request,
  ): Promise<SchemeAdminDto> {
    return this.catalogue.setActive(
      user.userId,
      schemeId,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
