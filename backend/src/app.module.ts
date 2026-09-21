import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import configuration from './config/configuration';
import { validate } from './config/validation';
import { AuditModule } from './infrastructure/audit/audit.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuthModule } from './modules/auth/auth.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { DecisionModule } from './modules/decision/decision.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { EnterprisesModule } from './modules/enterprises/enterprises.module';
import { HealthModule } from './modules/health/health.module';
import { InspectionsModule } from './modules/inspections/inspections.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OfficerModule } from './modules/officer/officer.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { SchemesModule } from './modules/schemes/schemes.module';
import { SlaModule } from './modules/sla/sla.module';
import { UsersModule } from './modules/users/users.module';
import { ValidationModule } from './modules/validation/validation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
      cache: true,
    }),
    CommonModule,
    PrismaModule,
    StorageModule,
    AuditModule,
    UsersModule,
    AuthModule,
    EnterprisesModule,
    ProjectsModule,
    DiscoveryModule,
    ApplicationsModule,
    DocumentsModule,
    OfficerModule,
    InspectionsModule,
    SlaModule,
    NotificationsModule,
    ComplianceModule,
    DecisionModule,
    SchemesModule,
    HealthModule,
    ValidationModule,
  ],
})
export class AppModule {}
