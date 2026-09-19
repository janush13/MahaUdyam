import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class FeasibilityService {
  constructor(private prisma: PrismaService) {}

  // 1. License Check: Must exist, be 'AAI' (Approved), and not expired
  async verifyTradeLicense(licenseNumber: string): Promise<boolean> {
    const license = await this.prisma.tradeLicenseRef.findUnique({
      where: { license_number: licenseNumber },
    });
    if (!license) return false;
    return license.status === 'AAI' && license.expiration_date > new Date();
  }

  // 2. Electricity Check: Check if subdivision grid load exceeds safe threshold (e.g., > 100MW)
  async verifyGridCapacity(subdivision: string): Promise<boolean> {
    const records = await this.prisma.electricityLoadRef.findMany({
      where: { subdivision },
    });
    const totalLoad = records.reduce((sum, record) => sum + record.current_load, 0);
    return totalLoad < 100.0; // Fails if area load is too high
  }

  // 3. Water Check: Verifies historical BOD is within safe limits for processing units (< 5.0)
  async verifyWaterSuitability(location: string): Promise<boolean> {
    const waterData = await this.prisma.waterQualityRef.findFirst({
      where: { location },
      orderBy: { id: 'desc' } // Gets most recent reading
    });
    if (!waterData) return true; // Pass if no data
    return waterData.ph >= 6.5 && waterData.ph <= 8.5 && waterData.bod < 5.0;
  }

  // 4. Food Adulteration Check: Flags high-risk product categories
  async checkHighRiskFood(productName: string): Promise<boolean> {
    const risk = await this.prisma.foodAdulterationRef.findFirst({
      where: { product_name: productName, health_risk: 'High' },
    });
    return !!risk; // Returns true if product has known high-risk adulterants
  }
}