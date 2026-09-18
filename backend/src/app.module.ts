import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import configuration from './config/configuration';
import { validate } from './config/validation';
import { AuditModule } from './infrastructure/audit/audit.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';

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
    HealthModule,
  ],
})
export class AppModule {}
