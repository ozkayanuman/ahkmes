import { Injectable } from "@nestjs/common";
import { OeeCalculationService } from "../oee/oee-calculation.service";
import type { OeeTimeBucket } from "../oee/oee.types";
import { ProductionCalendarService } from "../production-calendar/production-calendar.service";

export type ShiftReportRequest = { tenantId: string; plantId: string; productionDate: string; asOf: Date };

const LOSS_BUCKETS: OeeTimeBucket[] = ["PLANNED_MAINTENANCE", "UNPLANNED_BREAKDOWN", "QUALITY_HOLD", "MATERIAL_SHORTAGE", "SETUP_CHANGEOVER", "OPERATOR_RESOURCE_PAUSE", "OTHER_PLANNED", "OTHER_UNPLANNED"];
const lossSeconds = (buckets: Record<OeeTimeBucket, number>) => LOSS_BUCKETS.reduce((total, bucket) => total + (buckets[bucket] ?? 0), 0);

@Injectable()
export class ShiftReportService {
  constructor(private readonly calendar: ProductionCalendarService, private readonly calculation: OeeCalculationService) {}

  /** Canonical plant-calendar shift projection; no local clock, run or alarm formula is used. */
  async report(request: ShiftReportRequest) {
    const windows = await this.calendar.shiftWindowsForProductionDate(request.tenantId, request.plantId, request.productionDate);
    const validWindows = windows.filter((window): window is typeof window & { start: Date; end: Date } => window.start !== null && window.end !== null);
    return Promise.all(validWindows.map(async (window) => {
      const result = await this.calculation.calculate({ tenantId: request.tenantId, plantId: request.plantId, from: window.start, to: window.end, asOf: request.asOf });
      const facts = result.metrics.facts;
      return { shift: window.code, label: window.name, start: window.start.toISOString(), end: window.end.toISOString(), goodCount: facts.goodCount, scrapCount: facts.scrapCount, quality: result.metrics.quality.value, performance: result.metrics.performance.value, availability: result.metrics.availability.value, oee: result.metrics.oee.value, downtimeSeconds: Math.round(lossSeconds(result.timeline.durationByBucket)), dataQuality: result.metrics.dataQuality, issues: result.metrics.issues };
    }));
  }
}
