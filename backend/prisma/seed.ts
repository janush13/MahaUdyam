import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

const ROLES: Array<{ code: string; description: string }> = [
  { code: 'APPLICANT', description: 'Entrepreneur/applicant managing enterprises, projects, and applications.' },
  { code: 'SCRUTINY_OFFICER', description: 'First-level departmental reviewer; recommends, never finally decides.' },
  { code: 'APPROVING_AUTHORITY', description: 'Final departmental decision-maker; sole holder of approve/reject authority.' },
  { code: 'INSPECTOR', description: 'Conducts site inspections and submits inspection reports.' },
  { code: 'DEPT_ADMIN', description: "Manages a department's configuration, staff, and SLA parameters." },
  { code: 'SCHEME_OFFICER', description: 'Manages the scheme catalogue and incentive applications.' },
  { code: 'GRIEVANCE_OFFICER', description: 'Triages, routes, and resolves grievances.' },
  { code: 'SYSTEM_ADMIN', description: 'Technical administration only — never holds statutory decision authority.' },
  { code: 'SUPER_ADMIN', description: 'Cross-department platform governance and master data ownership.' },
  { code: 'LEGAL_COMPLIANCE', description: 'Authors/approves regulatory content; publishes regulatory knowledge.' },
  { code: 'AUDITOR', description: 'Independent, read-only, cross-cutting review of processes and audit trails.' },
  { code: 'LEADERSHIP', description: 'Read-only aggregated dashboards; no individual applicant/officer detail.' },
];

const PERMISSIONS: Array<{ code: string; description: string }> = [
  { code: 'USER_READ', description: "Read another user's account/role information." },
  { code: 'USER_MANAGE', description: 'Create, deactivate, or assign roles to user accounts.' },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['USER_READ', 'USER_MANAGE'],
  SYSTEM_ADMIN: ['USER_READ', 'USER_MANAGE'],
  DEPT_ADMIN: ['USER_READ', 'USER_MANAGE'],
};

// Dependency-free CSV line parser (handles commas inside quotes)
function parseCSVLine(line: string): string[] {
  const re = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
  return line.split(re).map(val => val.replace(/^"|"$/g, '').trim());
}

async function processCSV(fileName: string, processRow: (columns: string[]) => Promise<void>) {
  const filePath = path.join(__dirname, 'data', fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}. Skipping...`);
    return;
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; } // Skip header row
    if (!line.trim()) continue;
    const columns = parseCSVLine(line);
    try { await processRow(columns); } catch (e) { /* Skip malformed row */ }
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — cannot seed.');
  }

  // Instantiate PrismaClient once
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    // --- 1. SYSTEM CONFIGURATION SEEDING ---
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

    // --- 2. KAGGLE DATA SEEDING ---
    console.log('\nSeeding Kaggle Data...');

    // Trade Licenses
    await processCSV('trade_license_sampled_500.csv', async (col) => {
      const licenseNumber = col[18]?.trim();
      const rawExpirationDate = col[25]?.trim();
      if (!licenseNumber || !rawExpirationDate) return;

      const expirationDate = new Date(rawExpirationDate);
      if (Number.isNaN(expirationDate.getTime())) {
        console.warn(`Skipping invalid expiration date for license ${licenseNumber}: ${rawExpirationDate}`);
        return;
      }

      await prisma.tradeLicenseRef.upsert({
        where: { license_number: licenseNumber },
        update: { status: col[28] || 'UNKNOWN', expiration_date: expirationDate },
        create: { license_number: licenseNumber, status: col[28] || 'UNKNOWN', expiration_date: expirationDate },
      });
    });

    // Electricity Load
    await processCSV('(ELECTRICITY)TG-NPDCL_consumption_detail_commercial_JANUARY-2025.csv', async (col) => {
      await prisma.electricityLoadRef.create({
        data: {
          subdivision: col[2],
          area: col[4],
          current_load: parseFloat(col[10] || '0'),
        },
      });
    });

    // Water Quality
    await processCSV('Water_Quality_Dataset.csv', async (col) => {
      await prisma.waterQualityRef.create({
        data: {
          location: col[1],
          ph: parseFloat(col[2] || '0'),
          turbidity: parseFloat(col[3] || '0'),
          bod: parseFloat(col[6] || '0'),
          lead: parseFloat(col[7] || '0'),
        },
      });
    });

    // Food Adulteration
    await processCSV('food_adulteration_data.csv', async (col) => {
      await prisma.foodAdulterationRef.create({
        data: {
          product_name: col[1],
          adulterant: col[4],
          severity: col[7],
          health_risk: col[8],
        },
      });
    });

    // Agmarknet
    await processCSV('agmarknet_sampled_100_per_state.csv', async (col) => {
      await prisma.agmarkPriceRef.create({
        data: {
          commodity: col[4],
          grade: col[6],
          modal_price: parseFloat(col[9] || '0'),
          state: col[11],
        },
      });
    });

    console.log('Kaggle Data Seeding Complete!');

  } catch (error) {
    console.error('Fatal Error during seeding:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Single execution point
main();