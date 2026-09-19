import { Injectable } from '@nestjs/common';
import { FeasibilityService } from './feasibility.service';

@Injectable()
export class ValidationService {
  // Add FeasibilityService to the constructor
  constructor(private feasibilityService: FeasibilityService) {}

  // Modify your existing validate method
  async validate(applicationData: any) {
    const errors = [];
    const warnings = [];

    // Assuming applicationData contains user form inputs:
    
    // Check 1: Trading License
    if (applicationData.licenseNumber) {
      const isValid = await this.feasibilityService.verifyTradeLicense(applicationData.licenseNumber);
      if (!isValid) errors.push({ field: "license", message: "Invalid or expired trading license." });
    }

    // Check 2: Electricity
    if (applicationData.subdivision) {
      const isGridSafe = await this.feasibilityService.verifyGridCapacity(applicationData.subdivision);
      if (!isGridSafe) errors.push({ field: "electricity", message: "Requested subdivision grid is at maximum capacity." });
    }

    // Check 3: Water Location
    if (applicationData.waterLocation) {
      const isWaterSafe = await this.feasibilityService.verifyWaterSuitability(applicationData.waterLocation);
      if (!isWaterSafe) errors.push({ field: "water", message: "Location water quality does not meet industrial BOD/pH standards." });
    }

    // Check 4: Food Product
    if (applicationData.productName) {
      const isHighRisk = await this.feasibilityService.checkHighRiskFood(applicationData.productName);
      if (isHighRisk) warnings.push({ field: "product", message: "High-risk product detected. FSSAI lab testing will be strictly enforced." });
    }

    return { errors, warnings, missingDocuments: [] };
  }
}