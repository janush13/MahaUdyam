import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { CreateEnterpriseDto } from './dto/create-enterprise.dto';
import { EnterpriseResponseDto } from './dto/enterprise-response.dto';
import { UpdateEnterpriseDto } from './dto/update-enterprise.dto';
import {
  EnterprisesService,
  toEnterpriseResponse,
} from './enterprises.service';
import { EnterpriseAccess } from './interfaces/enterprise-access.interface';

/**
 * Authentication is global (JwtAuthGuard); RolesGuard restricts the whole
 * controller to the APPLICANT role; per-enterprise authorisation is the
 * job of @EnterpriseAccessRequired on each `:enterpriseId` route.
 */
@ApiTags('Enterprises')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller('enterprises')
export class EnterprisesController {
  constructor(private readonly enterprises: EnterprisesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an enterprise owned by the authenticated applicant',
    description:
      'The caller becomes the owner (Applicant Admin). A unique Enterprise Reference Number is generated on save.',
  })
  @ApiCreatedResponse({ type: EnterpriseResponseDto })
  create(
    @Body() dto: CreateEnterpriseDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<EnterpriseResponseDto> {
    return this.enterprises.create(user.userId, dto, req.ip ?? 'unknown');
  }

  @Get()
  @ApiOperation({
    summary:
      'List enterprises the caller owns or holds an active representative authorisation for',
  })
  @ApiOkResponse({ type: [EnterpriseResponseDto] })
  list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EnterpriseResponseDto[]> {
    return this.enterprises.listForUser(user.userId);
  }

  @Get(':enterpriseId')
  @EnterpriseAccessRequired('VIEW_ONLY')
  @ApiOperation({
    summary:
      'View one enterprise (owner, or an active representative of any scope)',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiOkResponse({ type: EnterpriseResponseDto })
  @ApiNotFoundResponse({
    description:
      'No such enterprise, or the caller has no live relationship to it (indistinguishable on purpose).',
  })
  get(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
  ): EnterpriseResponseDto {
    return toEnterpriseResponse(access.enterprise, access);
  }

  @Put(':enterpriseId')
  @EnterpriseAccessRequired('OWNER')
  @ApiOperation({
    summary: "Update the enterprise's own profile (owner only)",
    description:
      'Omitted fields are unchanged; optional fields can be cleared with null. A representative — even with FULL delegation — cannot change the enterprise profile (FRD §20.3).',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiOkResponse({ type: EnterpriseResponseDto })
  @ApiNotFoundResponse({
    description: 'No live relationship to this enterprise.',
  })
  @ApiForbiddenResponse({
    description:
      'FORBIDDEN_SCOPE — the caller is a representative, not the owner.',
  })
  update(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateEnterpriseDto,
    @Req() req: Request,
  ): Promise<EnterpriseResponseDto> {
    return this.enterprises.update(
      access,
      user.userId,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
