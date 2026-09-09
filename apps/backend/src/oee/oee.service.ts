import { Injectable } from "@nestjs/common";
import {
  OeeCalculationService,
  type OeeCalculationRequest,
} from "./oee-calculation.service";
import type { OeeSourceInterval, OeeTimeBucket } from "./oee.types";

export interface DayBucket {
  date: string;
  goodCount: number;
  scrapCount: number;
  runtimeSeconds: number;
  quality: number | null;
  performance: number | null;
  availability: number | null;
  oee: number | null;
  downtimeSeconds: number;
}

const LOSS_BUCKETS = new Set<OeeTimeBucket>([
  "PLANNED_MAINTENANCE",
  "UNPLANNED_BREAKDOWN",
  "QUALITY_HOLD",
  "MATERIAL_SHORTAGE",
  "SETUP_CHANGEOVER",
  "OPERATOR_RESOURCE_PAUSE",
  "OTHER_PLANNED",
  "OTHER_UNPLANNED",
]);

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function dayWindows(request: OeeCalculationRequest): { date: string; from: Date; to: Date }[] {
  const cutoff = new Date(Math.min(request.to.getTime(), request.asOf.getTime()));
  const windows: { date: string; from: Date; to: Date }[] = [];
  let from = new Date(request.from);
  while (from < cutoff) {
    const nextDay = startOfUtcDay(from);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const to = new Date(Math.min(nextDay.getTime(), cutoff.getTime()));
    windows.push({ date: from.toISOString().slice(0, 10), from, to });
    from = to;
  }
  return windows;
}

function lossSeconds(durationByBucket: Record<OeeTimeBucket, number>): number {
  return [...LOSS_BUCKETS].reduce((sum, bucket) => sum + (durationByBucket[bucket] ?? 0), 0);
}

function provenanceLabel(source: OeeSourceInterval | undefined, bucket: OeeTimeBucket): string {
  const provenance = source?.provenance;
  if (provenance) {
    for (const key of ["reasonLabel", "reasonCode", "reason", "source"]) {
      const value = provenance[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return bucket;
}

/** Compatibility projections backed exclusively by canonical OEE calculations. */
@Injectable()
export class OeeService {
  constructor(private readonly calculation: OeeCalculationService) {}

  calculate(request: OeeCalculationRequest) {
    return this.calculation.calculate(request);
  }

  /** Daily projection from one caller-supplied canonical plant/range/cutoff context. */
  async trend(request: OeeCalculationRequest): Promise<DayBucket[]> {
    return Promise.all(dayWindows(request).map(async (window) => {
      const calculation = await this.calculation.calculate({ ...request, from: window.from, to: window.to });
      const facts = calculation.metrics.facts;
      return {
        date: window.date,
        goodCount: facts.goodCount,
        scrapCount: facts.scrapCount,
        runtimeSeconds: facts.runTimeSeconds,
        quality: calculation.metrics.quality.value,
        performance: calculation.metrics.performance.value,
        availability: calculation.metrics.availability.value,
        oee: calculation.metrics.oee.value,
        downtimeSeconds: lossSeconds(calculation.timeline.durationByBucket),
      };
    }));
  }

  /** Loss Pareto projected from canonical normalized source attribution. */
  async downtimePareto(request: OeeCalculationRequest) {
    const calculation = await this.calculation.calculate(request);
    const byReason = new Map<string, { totalSeconds: number; sourceIds: Set<string> }>();

    const sourceById = new Map(calculation.sources.map((source) => [source.id, source]));
    for (const segment of calculation.timeline.segments) {
      if (!LOSS_BUCKETS.has(segment.bucket)) continue;
      const sourceId = segment.sourceIds.find((id) => sourceById.get(id)?.bucket === segment.bucket) ?? `bucket:${segment.bucket}`;
      const reason = provenanceLabel(sourceById.get(sourceId), segment.bucket);
      const current = byReason.get(reason) ?? { totalSeconds: 0, sourceIds: new Set<string>() };
      current.totalSeconds += segment.durationSeconds;
      current.sourceIds.add(sourceId);
      byReason.set(reason, current);
    }

    return [...byReason.entries()]
      .map(([reason, value]) => ({ reason, totalSeconds: Math.round(value.totalSeconds), count: value.sourceIds.size }))
      .sort((left, right) => right.totalSeconds - left.totalSeconds || left.reason.localeCompare(right.reason));
  }
}
