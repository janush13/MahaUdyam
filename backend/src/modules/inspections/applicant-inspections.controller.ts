import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { APPLICATION_READ_LEVEL } from '../applications/constants/application.constants';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CurrentEnterpriseAccess,
  EnterpriseAccessRequired,
} from '../enterprises/decorators/enterprise-access.decorator';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { ApplicantInspectionsService } from './applicant-inspections.service';
import {
  ApplicantInspectionDto,
  ApplicantInspectionsDto,
} from './dto/applicant-inspection.dto';

const FORBIDDEN =
  'FORBIDDEN_SCOPE — the caller has no access to this enterprise or project.';
const NOT_FOUND =
  'No such application / inspection in this project (an id from another project or enterprise is indistinguishable).';

/**
 * The applicant's read-only view of their application's inspections (FRD 24.1,
 * Blueprint 13.7). Nested under the enterprise / project like every other
 * applicant route, so `EnterpriseAccessGuard` is the only authorisation
 * mechanism: an owner, or a representative with at least view access to the
 * project. Nothing here writes.
 */
@ApiTags('Applications')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller(
  'enterprises/:enterpriseId/projects/:projectId/applications/:applicationId/inspections',
)
export class ApplicantInspectionsController {
  constructor(private readonly inspections: ApplicantInspectionsService) {}

  @Get()
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({
    summary: 'Inspection status and outcome for my application',
    description:
      'Whether the approval calls for an inspection, and each inspection with its live status (Pending → Scheduled → Completed), the date, and the outcome once recorded. The inspector, internal notes, checklist results and evidence are not included.',
  })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiOkResponse({ type: ApplicantInspectionsDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  list(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ApplicantInspectionsDto> {
    return this.inspections.list(access, projectId, applicationId);
  }

  @Get(':inspectionId')
  @EnterpriseAccessRequired(APPLICATION_READ_LEVEL)
  @ApiOperation({ summary: 'One inspection of my application' })
  @ApiParam({ name: 'enterpriseId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'inspectionId', format: 'uuid' })
  @ApiOkResponse({ type: ApplicantInspectionDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  get(
    @CurrentEnterpriseAccess() access: EnterpriseAccess,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('inspectionId', ParseUUIDPipe) inspectionId: string,
  ): Promise<ApplicantInspectionDto> {
    return this.inspections.get(access, projectId, applicationId, inspectionId);
  }
}
