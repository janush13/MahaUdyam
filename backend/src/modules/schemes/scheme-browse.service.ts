import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BrowseSchemesQueryDto } from './dto/scheme-request.dto';
import { SchemeDto, SchemeListDto } from './dto/scheme-response.dto';
import { DEFAULT_PAGE_SIZE } from './scheme.constants';
import { SCHEME_INCLUDE, SchemeRow, toSchemeDto } from './scheme.mappers';

const norm = (s: string): string => s.trim().toLowerCase();

/** A facet the department listed (`values`) matches when it names `wanted`; a
 * scheme that lists none is not restricted on that facet and stays listed. */
const matchesFacet = (values: string[] | null, wanted: string): boolean =>
  !values ||
  values.length === 0 ||
  values.some((v) => norm(v) === norm(wanted));

/** What an applicant or the public can see: PUBLISHED and active schemes of
 * active departments. A draft, a deactivated scheme and one whose department is
 * deactivated are indistinguishable from a nonexistent one. */
export const AVAILABLE_SCHEME_WHERE = {
  publishStatus: 'PUBLISHED',
  isActive: true,
  department: { isActive: true },
} satisfies Prisma.SchemeWhereInput;

/**
 * The scheme catalogue as applicants and the public browse it (FRD 29.1 / 29.2,
 * Blueprint 13.9 `GET /schemes`): keyword search and filters by sector,
 * location / district, enterprise size and benefit type. It shows the published
 * catalogue and nothing else - never a draft, an eligibility rule, or who
 * maintains it - and needs no account (FRD 6 makes it public).
 *
 * The catalogue is small and department-curated, so filtering and paging happen
 * over the available set in memory: text facets compare trimmed and
 * case-insensitively, which a database array operator cannot.
 */
@Injectable()
export class SchemeBrowseService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: BrowseSchemesQueryDto): Promise<SchemeListDto> {
    const rows = await this.prisma.scheme.findMany({
      where: {
        ...AVAILABLE_SCHEME_WHERE,
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      },
      include: SCHEME_INCLUDE,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const q = query.q ? norm(query.q) : null;
    const matching = rows.filter(
      (s) =>
        (!q || this.matchesKeyword(s, q)) &&
        (!query.sector || matchesFacet(s.applicableSectors, query.sector)) &&
        (!query.district ||
          matchesFacet(s.applicableDistricts, query.district)) &&
        (!query.enterpriseSize ||
          matchesFacet(s.applicableEnterpriseSizes, query.enterpriseSize)) &&
        (!query.benefitType ||
          (s.benefitType !== null &&
            norm(s.benefitType) === norm(query.benefitType))),
    );
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const now = new Date();
    return {
      items: matching
        .slice((page - 1) * pageSize, page * pageSize)
        .map((s) => toSchemeDto(s, now)),
      total: matching.length,
      page,
      pageSize,
    };
  }

  async get(schemeId: string): Promise<SchemeDto> {
    return toSchemeDto(await this.findAvailable(schemeId));
  }

  /** One available scheme, or a 404 - the same answer for a draft, an inactive
   * scheme, a malformed id and one that does not exist. */
  async findAvailable(schemeId: string): Promise<SchemeRow> {
    const row = UUID.test(schemeId)
      ? await this.prisma.scheme.findFirst({
          where: { id: schemeId, ...AVAILABLE_SCHEME_WHERE },
          include: SCHEME_INCLUDE,
        })
      : null;
    if (!row) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Scheme not found.',
      });
    }
    return row;
  }

  private matchesKeyword(s: SchemeRow, q: string): boolean {
    return [s.name, s.description, s.benefits, s.eligibilityCriteria].some(
      (f) => norm(f).includes(q),
    );
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
