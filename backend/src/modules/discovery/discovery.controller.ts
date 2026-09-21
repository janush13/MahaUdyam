import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
  DISCOVERY_READ_LEVEL,
  DISCOVERY_RUN_LEVEL,
} from './discovery.constants';
import {
  DiscoveryResultDto,
  DiscoverySnapshotSummaryDto,
} from './dto/discovery-response.dto';
import { DiscoveryService } from './discovery.service';

/**
 * Nested under the project (Blueprint §13.3 `POST /projects/:id/discover-
 * approvals`, in this API's enterprise-nested form) so the existing
 * EnterpriseAccessGuard resolves the caller's relationship from
 * `:enterpriseId` and checks a project-restricted representative's list
 * against `:projectId`. That guard is the ONLY authorisation mechanism here.
 */
@ApiTags('Approval discovery')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller('enterprises/:enterpriseId/projects/:projectId')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Post('discover-approvals')
  @EnterpriseAccessRequired(DISCOVERY_RUN_LEVEL)
  @ApiOperation({
    summary:
      'Run approval discovery for a project and persist an immutable snapshot',
    description:
      'Evaluates the currently effective rules against the project’s characteristics. Returns the potentially applicable approvals (with department, rule version and a plain-language explanation) and the rules that did not apply, with reasons. This is a recommendation, not a statutory determination. Requires PREPARE_SUBMIT or above for representatives; a representative restricted to specific projects can run it only for those.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiCreatedResponse({ type: DiscoveryResultDto })
  @ApiNotFoundResponse({
    description:
      'No live relationship to the enterprise, or no such project in it.',
  })
  @ApiForbiddenResponse({
    description: 'FORBIDDEN_SCOPE — scope or project restriction insufficient.',
  })
  run(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<DiscoveryResultDto> {
    return this.discovery.run(
      access,
      projectId,
      user.userId,
      req.ip ?? 'unknown',
    );
  }

  @Get('discoveries')
  @EnterpriseAccessRequired(DISCOVERY_READ_LEVEL)
  @ApiOperation({
    summary: 'List a project’s discovery snapshots, newest first',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOkResponse({ type: [DiscoverySnapshotSummaryDto] })
  list(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<DiscoverySnapshotSummaryDto[]> {
    return this.discovery.list(access, projectId);
  }

  @Get('discoveries/:snapshotId')
  @EnterpriseAccessRequired(DISCOVERY_READ_LEVEL)
  @ApiOperation({
    summary: 'Re-read a stored discovery result exactly as it was produced',
    description:
      'Returns the snapshot as persisted — later rule, project or department changes never alter it — plus whether the engine reproduces it from the stored rules and inputs.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'snapshotId', format: 'uuid' })
  @ApiOkResponse({ type: DiscoveryResultDto })
  @ApiNotFoundResponse({
    description:
      'No such snapshot for this project (indistinguishable from another project’s).',
  })
  get(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
  ): Promise<DiscoveryResultDto> {
    return this.discovery.get(access, projectId, snapshotId);
  }
}
