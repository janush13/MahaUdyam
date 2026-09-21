import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
} from '../enterprises/decorators/enterprise-access.decorator';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import {
  PROJECT_READ_LEVEL,
  PROJECT_WRITE_LEVEL,
} from './constants/project-values.constant';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectResponseDto } from './dto/project-response.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

/**
 * Nested under the enterprise (TRD §11: `/enterprises/{id}/projects`) so the
 * existing EnterpriseAccessGuard can resolve the caller's relationship from
 * `:enterpriseId` — and, on the single-project routes, check a
 * project-restricted representative's list against `:projectId`. This is the
 * ONLY authorisation mechanism: no second permission system exists here.
 */
@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller('enterprises/:enterpriseId/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @EnterpriseAccessRequired(PROJECT_WRITE_LEVEL)
  @ApiOperation({
    summary:
      'Create a project under the enterprise (owner, or a FULL representative with no project restriction)',
    description:
      'The project always belongs to the enterprise in the URL, which the caller must be authorised for — no enterprise or owner field is accepted in the body. A Project Reference Number is generated on save. A representative restricted to specific projects cannot create new ones.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiCreatedResponse({ type: ProjectResponseDto })
  @ApiNotFoundResponse({
    description:
      'No live relationship to the enterprise (indistinguishable from a nonexistent one).',
  })
  @ApiForbiddenResponse({
    description: 'FORBIDDEN_SCOPE — scope or project restriction insufficient.',
  })
  create(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
    @Req() req: Request,
  ): Promise<ProjectResponseDto> {
    return this.projects.create(access, user.userId, dto, req.ip ?? 'unknown');
  }

  @Get()
  @EnterpriseAccessRequired(PROJECT_READ_LEVEL)
  @ApiOperation({
    summary: "List the enterprise's projects",
    description:
      'A representative restricted to specific projects sees only those.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiOkResponse({ type: [ProjectResponseDto] })
  @ApiNotFoundResponse({
    description: 'No live relationship to the enterprise.',
  })
  list(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
  ): Promise<ProjectResponseDto[]> {
    return this.projects.list(access);
  }

  @Get(':projectId')
  @EnterpriseAccessRequired(PROJECT_READ_LEVEL)
  @ApiOperation({
    summary:
      'View one project (any live scope; restricted representatives only their projects)',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiNotFoundResponse({
    description:
      'No such project in this enterprise (a project id from another enterprise is indistinguishable).',
  })
  @ApiForbiddenResponse({
    description:
      'FORBIDDEN_SCOPE — project outside the representative’s authorised list.',
  })
  get(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectResponseDto> {
    return this.projects.get(access, projectId);
  }

  @Put(':projectId')
  @EnterpriseAccessRequired(PROJECT_WRITE_LEVEL)
  @ApiOperation({
    summary:
      "Update a project's characteristics (owner, or a FULL representative for this project)",
    description:
      'Omitted fields are unchanged; optional fields can be cleared with null. There is no status field — the requirements define no project lifecycle.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiForbiddenResponse({
    description: 'FORBIDDEN_SCOPE — scope or project restriction insufficient.',
  })
  update(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProjectDto,
    @Req() req: Request,
  ): Promise<ProjectResponseDto> {
    return this.projects.update(
      access,
      projectId,
      user.userId,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
