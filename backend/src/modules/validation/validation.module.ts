import { Module } from '@nestjs/common';
import { ValidationService } from './validation.service';
import { FeasibilityService } from './feasibility.service';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module'; // Import Prisma

@Module({
  imports: [PrismaModule],
  providers: [ValidationService, FeasibilityService],
  exports: [ValidationService], // Allows other modules to use validation
})
export class ValidationModule {}