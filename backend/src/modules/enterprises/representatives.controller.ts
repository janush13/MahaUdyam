import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import {
  CurrentEnterpriseAccess,
  EnterpriseAccessRequired,
} from './decorators/enterprise-access.decorator';
import { AuthoriseRepresentativeDto } from './dto/authorise-representative.dto';
import { RepresentativeResponseDto } from './dto/representative-response.dto';
import { UpdateRepresentativeDto } from './dto/update-representative.dto';
import { EnterpriseAccess } from './interfaces/enterprise-access.interface';
import { RepresentativesService } from './representatives.service';

/**
 * Every route here is OWNER-only: granting, changing and revoking
 * representative access belongs to the Applicant Admin alone (FRD §20.3). A
 * representative of any scope receives 403 FORBIDDEN_SCOPE, a stranger 404.
 */
@ApiTags('Enterprise representatives')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller('enterprises/:enterpriseId/representatives')
export class RepresentativesController {
  constructor(private readonly representatives: RepresentativesService) {}

  @Post()
  @EnterpriseAccessRequired('OWNER')
  @ApiOperation({
    summary: 'Authorise a representative (owner only)',
    description:
      'Creates a PENDING authorisation for a registered user identified by email or mobile. It grants no access until that user accepts it (FRD §20.2). There is no way to create an ACTIVE authorisation directly.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiCreatedResponse({ type: RepresentativeResponseDto })
  @ApiForbiddenResponse({
    description: 'FORBIDDEN_SCOPE — caller is not the owner.',
  })
  @ApiNotFoundResponse({
    description:
      'No live relationship to the enterprise, or REPRESENTATIVE_USER_NOT_FOUND.',
  })
  @ApiConflictResponse({ description: 'REPRESENTATIVE_ALREADY_AUTHORISED.' })
  authorise(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AuthoriseRepresentativeDto,
    @Req() req: Request,
  ): Promise<RepresentativeResponseDto> {
    return this.representatives.authorise(
      access,
      user.userId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get()
  @EnterpriseAccessRequired('OWNER')
  @ApiOperation({
    summary: "List the enterprise's representative authorisations (owner only)",
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiOkResponse({ type: [RepresentativeResponseDto] })
  @ApiForbiddenResponse({
    description: 'FORBIDDEN_SCOPE — caller is not the owner.',
  })
  list(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
  ): Promise<RepresentativeResponseDto[]> {
    return this.representatives.list(access.enterprise.id);
  }

  @Patch(':representativeId')
  @EnterpriseAccessRequired('OWNER')
  @ApiOperation({
    summary:
      "Change a representative's scope, project restriction or expiry (owner only)",
    description:
      'Increasing the scope or widening the project list sends an ACTIVE authorisation back to PENDING: the representative must accept again. Narrowing takes effect immediately. A revoked authorisation cannot be changed.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'representativeId', format: 'uuid' })
  @ApiOkResponse({ type: RepresentativeResponseDto })
  @ApiForbiddenResponse({
    description: 'FORBIDDEN_SCOPE — caller is not the owner.',
  })
  @ApiConflictResponse({ description: 'AUTHORISATION_REVOKED.' })
  update(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('representativeId', ParseUUIDPipe) representativeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateRepresentativeDto,
    @Req() req: Request,
  ): Promise<RepresentativeResponseDto> {
    return this.representatives.update(
      access,
      representativeId,
      user.userId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Delete(':representativeId')
  @HttpCode(HttpStatus.OK)
  @EnterpriseAccessRequired('OWNER')
  @ApiOperation({
    summary: 'Revoke a representative authorisation (owner only)',
    description:
      'Effective immediately and permanent (the record is kept, marked REVOKED). Idempotent.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'representativeId', format: 'uuid' })
  @ApiOkResponse({ type: RepresentativeResponseDto })
  @ApiForbiddenResponse({
    description: 'FORBIDDEN_SCOPE — caller is not the owner.',
  })
  revoke(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('representativeId', ParseUUIDPipe) representativeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<RepresentativeResponseDto> {
    return this.representatives.revoke(
      access,
      representativeId,
      user.userId,
      req.ip ?? 'unknown',
    );
  }
}
