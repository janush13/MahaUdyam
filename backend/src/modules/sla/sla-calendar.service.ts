import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { SlaSettings } from '../../config/sla.config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WorkingCalendar, localDateOf } from './working-days';

type Db = Prisma.TransactionClient | PrismaService;

/** Builds the working-day calendar for a department (Blueprint 23.2, TRD 12:
 * "configurable Maharashtra government holiday calendar, distinct per
 * department if needed"): the state-wide holidays plus the department's own. */
@Injectable()
export class SlaCalendarService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  get settings(): SlaSettings {
    return this.config.get('sla', { infer: true });
  }

  async forDepartment(
    db: Db,
    departmentId: string,
    from: Date,
  ): Promise<WorkingCalendar> {
    const { utcOffsetMinutes, weekendDays } = this.settings;
    const rows = await db.slaHoliday.findMany({
      where: {
        OR: [{ departmentId: null }, { departmentId }],
        // A holiday before the start can never fall inside the window.
        holidayDate: {
          gte: new Date(`${localDateOf(from, utcOffsetMinutes)}T00:00:00.000Z`),
        },
      },
      select: { holidayDate: true },
    });
    return {
      utcOffsetMinutes,
      weekendDays,
      holidays: new Set(
        rows.map((r) => r.holidayDate.toISOString().slice(0, 10)),
      ),
    };
  }
}
