import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
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
import { MyAuthorisationResponseDto } from './dto/representative-response.dto';
import { RepresentativesService } from './representatives.service';

/**
 * The representative's side of FRD §20.2's two-sided consent. Every query
 * here is keyed on the authenticated user's own id, so one user can never
 * see or accept another user's authorisation.
 */
@ApiTags('Enterprise representatives')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('APPLICANT')
@Controller('representative-authorisations')
export class RepresentativeAuthorisationsController {
  constructor(private readonly representatives: RepresentativesService) {}

  @Get()
  @ApiOperation({
    summary:
      'List authorisations offered to (or held by) the authenticated user',
    description:
      'Shows PENDING invitations to accept and ACTIVE authorisations. Revoked ones are not listed.',
  })
  @ApiOkResponse({ type: [MyAuthorisationResponseDto] })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyAuthorisationResponseDto[]> {
    return this.representatives.listMine(user.userId);
  }

  @Post(':authorisationId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a PENDING authorisation offered to the authenticated user',
    description:
      'Takes no body: the representative can accept or not, never alter the scope. Access starts only now.',
  })
  @ApiParam({ name: 'authorisationId', format: 'uuid' })
  @ApiOkResponse({ type: MyAuthorisationResponseDto })
  @ApiNotFoundResponse({
    description:
      'No such authorisation for this user (indistinguishable on purpose).',
  })
  @ApiConflictResponse({
    description:
      'AUTHORISATION_REVOKED, AUTHORISATION_EXPIRED or AUTHORISATION_ALREADY_ACTIVE.',
  })
  accept(
    @Param('authorisationId', ParseUUIDPipe) authorisationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MyAuthorisationResponseDto> {
    return this.representatives.accept(
      user.userId,
      authorisationId,
      req.ip ?? 'unknown',
    );
  }
}
