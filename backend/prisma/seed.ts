import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Seeds SYSTEM CONFIGURATION only — the approved role roster, the minimal
 * permission set Step 4 actually implements, and their mapping. This is
 * platform configuration, not government data: it does not seed
 * departments, approval types, approval rules, schemes, or any other
 * statutory/regulatory content, because none of those can be sourced from
 * FRD/TRD/Blueprint without inventing real government configuration.
 *
 * Deliberately excludes INTEGRATION_ADMINISTRATOR and HELPDESK, which
 * appear in the TRD's stakeholder list but were deferred by the
 * architecture analysis — see prisma/schema.prisma's Department section
 * comment and the Step 2 report for the reasoning (no FRD screen or
 * permission row references either role).
 */
const ROLES: Array<{ code: string; description: string }> = [
  {
    code: 'APPLICANT',
    description: 'Entrepreneur/applicant managing enterprises, projects, and applications.',
  },
  {
    code: 'SCRUTINY_OFFICER',
    description: 'First-level departmental reviewer; recommends, never finally decides.',
  },
  {
    code: 'APPROVING_AUTHORITY',
    description: 'Final departmental decision-maker; sole holder of approve/reject authority.',
  },
  {
    code: 'INSPECTOR',
    description: 'Conducts site inspections and submits inspection reports.',
  },
  {
    code: 'DEPT_ADMIN',
    description: "Manages a department's configuration, staff, and SLA parameters.",
  },
  {
    code: 'SCHEME_OFFICER',
    description: 'Manages the scheme catalogue and incentive applications.',
  },
  {
    code: 'GRIEVANCE_OFFICER',
    description: 'Triages, routes, and resolves grievances.',
  },
  {
    code: 'SYSTEM_ADMIN',
    description: 'Technical administration only — never holds statutory decision authority.',
  },
  {
    code: 'SUPER_ADMIN',
    description: 'Cross-department platform governance and master data ownership.',
  },
  {
    code: 'LEGAL_COMPLIANCE',
    description: 'Authors/approves regulatory content; publishes regulatory knowledge.',
  },
  {
    code: 'AUDITOR',
    description: 'Independent, read-only, cross-cutting review of processes and audit trails.',
  },
  {
    code: 'LEADERSHIP',
    description: 'Read-only aggregated dashboards; no individual applicant/officer detail.',
  },
];

/**
 * Deliberately minimal — NOT the eventual full catalogue (ENTERPRISE_*,
 * APPLICATION_*, DOCUMENT_*, etc.), which belongs to the business modules
 * that actually implement those capabilities. These two are the only
 * capabilities Step 4 itself implements or gates (privileged role
 * assignment, via UsersService.assignRole — an internal service capability
 * with no public endpoint yet). Each future module adds its own permission
 * codes when it's actually built, per the architecture analysis's
 * "avoid hundreds of speculative permissions" guidance.
 */
const PERMISSIONS: Array<{ code: string; description: string }> = [
  { code: 'USER_READ', description: "Read another user's account/role information." },
  { code: 'USER_MANAGE', description: 'Create, deactivate, or assign roles to user accounts.' },
];

/**
 * Roles matching FRD's own stated capabilities: SUPER_ADMIN (cross-
 * department governance, FRD §4.9-adjacent), SYSTEM_ADMIN ("user account
 * provisioning/deactivation", FRD §4.9 explicitly), DEPT_ADMIN ("manage
 * users within their own department", FRD §4.6). Department-scoping of
 * DEPT_ADMIN's grant is enforced at the service/guard layer (§17's
 * primitives), not by a separate permission code.
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['USER_READ', 'USER_MANAGE'],
  SYSTEM_ADMIN: ['USER_READ', 'USER_MANAGE'],
  DEPT_ADMIN: ['USER_READ', 'USER_MANAGE'],
};

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — cannot seed.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  console.log('Seeding roles (system configuration — not statutory/government data)...');
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { description: role.description },
      create: role,
    });
  }
  console.log(`Seeded ${ROLES.length} roles.`);

  console.log('Seeding permissions...');
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { description: permission.description },
      create: permission,
    });
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions.`);

  console.log('Seeding role-permission mappings...');
  let mappingCount = 0;
  for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });

    for (const permissionCode of permissionCodes) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: permissionCode } });

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
      mappingCount += 1;
    }
  }
  console.log(`Seeded ${mappingCount} role-permission mappings.`);

  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  process.exit(1);
});
