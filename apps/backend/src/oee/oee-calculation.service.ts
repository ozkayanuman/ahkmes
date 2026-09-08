import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ProductionCalendarService } from "../production-calendar/production-calendar.service";
import { PrismaService } from "../prisma/prisma.service";
import { OeeSnapshotSynchronization } from "./oee-snapshot-synchronization";
import { downtimeEventsToIntervals, type OeeDowntimeEvent } from "./downtime-intervals";
import type { OeeDataQualityIssue, OeeDataQualityStatus, OeeSourceInterval } from "./oee.types";
import { qualityHoldsToIntervals, type OeeQualityHold } from "./quality-hold-intervals";
import { executionEventsToIntervals, type OeeExecutionEvent } from "./execution-intervals";
import { normalizeOeeTimeline } from "./interval-normalizer";
import { resolvePlannedProductionTime, type ResolvePlannedProductionTimeInput } from "./planned-time";

export type OeeComponentFacts = {
  plannedProductionTimeSeconds: number | null;
  runTimeSeconds: number;
  idealProductionTimeSeconds: number | null;
  totalCount: number;
  goodCount: number;
  scrapCount: number;
  reworkCount: number;
};

export type OeeMetric = {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
};

export type OeeMetrics = {
  facts: OeeComponentFacts;
  availability: OeeMetric;
  performance: OeeMetric;
  quality: OeeMetric;
  oee: OeeMetric;
  dataQuality: OeeDataQualityStatus;
  issues: OeeDataQualityIssue[];
};

export type CanonicalOeeOperation = {
  id: string;
  idealCycleTimeSec: number | null;
};

export type CanonicalOeeReport = {
  id: string;
  operationId: string;
  goodQty: number;
  scrapQty: number;
  reworkQty: number;
};

export type CanonicalOeeCalculationInput = ResolvePlannedProductionTimeInput & {
  operations: readonly CanonicalOeeOperation[];
  executionEvents: readonly OeeExecutionEvent[];
  reports: readonly CanonicalOeeReport[];
  downtimeIntervals?: readonly OeeSourceInterval[];
  qualityHoldIntervals?: readonly OeeSourceInterval[];
};

export type CanonicalOeeCalculation = {
  plannedTime: ReturnType<typeof resolvePlannedProductionTime>;
  timeline: ReturnType<typeof normalizeOeeTimeline>;
  metrics: OeeMetrics;
  sources: OeeSourceInterval[];
};

export type OeeCalculationRequest = {
  tenantId: string;
  plantId: string;
  workOrderId?: string;
  from: Date;
  to: Date;
  asOf: Date;
};

function unavailable(numerator: number | null, denominator: number | null): OeeMetric {
  return { value: null, numerator, denominator };
}

function measured(numerator: number, denominator: number): OeeMetric {
  return { value: numerator / denominator, numerator, denominator };
}

function issue(
  issues: OeeDataQualityIssue[],
  code: string,
  status: OeeDataQualityIssue["status"],
  message: string,
) {
  issues.push({ code, status, message });
}

function overallQuality(issues: readonly OeeDataQualityIssue[]): OeeDataQualityStatus {
  if (issues.some((item) => item.status === "MISSING_STANDARD")) return "MISSING_STANDARD";
  if (issues.some((item) => item.status === "INSUFFICIENT_DATA")) return "INSUFFICIENT_DATA";
  if (issues.some((item) => item.status === "STALE_SOURCE")) return "STALE_SOURCE";
  if (issues.length) return "PARTIAL";
  return "COMPLETE";
}

/** Pure formula layer. It never clamps values and never substitutes one for a missing component. */
export function calculateOeeMetrics(facts: OeeComponentFacts): OeeMetrics {
  const issues: OeeDataQualityIssue[] = [];

  let availability: OeeMetric;
  if (facts.plannedProductionTimeSeconds === null || facts.plannedProductionTimeSeconds <= 0) {
    availability = unavailable(facts.runTimeSeconds, facts.plannedProductionTimeSeconds);
    issue(issues, "MISSING_PLANNED_PRODUCTION_TIME", "INSUFFICIENT_DATA", "Planned production time could not be established from canonical schedule and calendar facts.");
  } else {
    availability = measured(facts.runTimeSeconds, facts.plannedProductionTimeSeconds);
    if (availability.value! > 1) {
      issue(issues, "RUN_TIME_EXCEEDS_PLANNED_TIME", "PARTIAL", "Normalized run time exceeds planned production time; the value is preserved for investigation.");
    }
  }

  let performance: OeeMetric;
  if (facts.idealProductionTimeSeconds === null) {
    performance = unavailable(null, facts.runTimeSeconds);
    issue(issues, "MISSING_IDEAL_CYCLE_STANDARD", "MISSING_STANDARD", "At least one contributing operation lacks an immutable ideal cycle standard.");
  } else if (facts.runTimeSeconds <= 0) {
    performance = unavailable(facts.idealProductionTimeSeconds, facts.runTimeSeconds);
    issue(issues, "MISSING_RUN_TIME", "INSUFFICIENT_DATA", "Performance requires positive normalized run time.");
  } else {
    performance = measured(facts.idealProductionTimeSeconds, facts.runTimeSeconds);
    if (performance.value! > 1) {
      issue(issues, "PERFORMANCE_ABOVE_EXPECTED", "PARTIAL", "Calculated Performance exceeds 100%; the standard and quantity evidence require review.");
    }
  }

  let quality: OeeMetric;
  if (facts.totalCount <= 0) {
    quality = unavailable(facts.goodCount, facts.totalCount);
    issue(issues, "MISSING_PRODUCTION_QUANTITY", "INSUFFICIENT_DATA", "Quality requires a positive first-pass total quantity.");
  } else if (facts.goodCount + facts.scrapCount !== facts.totalCount) {
    quality = unavailable(facts.goodCount, facts.totalCount);
    issue(issues, "QUANTITY_TOTAL_MISMATCH", "PARTIAL", "Good and scrap quantities do not reconcile with first-pass total quantity.");
  } else {
    quality = measured(facts.goodCount, facts.totalCount);
  }

  const oeeValue = availability.value !== null && performance.value !== null && quality.value !== null
    ? availability.value * performance.value * quality.value
    : null;
  const oee: OeeMetric = {
    value: oeeValue,
    numerator: oeeValue,
    denominator: oeeValue === null ? null : 1,
  };

  return {
    facts: { ...facts },
    availability,
    performance,
    quality,
    oee,
    dataQuality: overallQuality(issues),
    issues,
  };
}

/** Aggregates formula inputs; percentages are deliberately absent from this API. */
export function aggregateOeeFacts(items: readonly OeeComponentFacts[]): OeeComponentFacts {
  return {
    plannedProductionTimeSeconds: items.some((item) => item.plannedProductionTimeSeconds === null)
      ? null
      : items.reduce((sum, item) => sum + item.plannedProductionTimeSeconds!, 0),
    runTimeSeconds: items.reduce((sum, item) => sum + item.runTimeSeconds, 0),
    idealProductionTimeSeconds: items.some((item) => item.idealProductionTimeSeconds === null)
      ? null
      : items.reduce((sum, item) => sum + item.idealProductionTimeSeconds!, 0),
    totalCount: items.reduce((sum, item) => sum + item.totalCount, 0),
    goodCount: items.reduce((sum, item) => sum + item.goodCount, 0),
    scrapCount: items.reduce((sum, item) => sum + item.scrapCount, 0),
    reworkCount: items.reduce((sum, item) => sum + item.reworkCount, 0),
  };
}

/**
 * Composes canonical, immutable facts into one OEE result. Database readers
 * belong outside this boundary so every caller can supply facts from one
 * repeatable-read snapshot and one explicit cutoff.
 */
export function calculateOeeFromCanonicalSources(input: CanonicalOeeCalculationInput): CanonicalOeeCalculation {
  const downtimeIntervals = input.downtimeIntervals ?? [];
  const qualityHoldIntervals = input.qualityHoldIntervals ?? [];
  const plannedTime = resolvePlannedProductionTime({
    ...input,
    plannedDowntime: [
      ...input.plannedDowntime,
      ...downtimeIntervals
        .filter((interval) => interval.bucket === "PLANNED_MAINTENANCE")
        .map((interval) => ({ id: interval.id, start: interval.start, end: interval.end })),
    ],
  });
  const plannedExclusionSources: OeeSourceInterval[] = [];
  for (const [index, segment] of plannedTime.segments.entries()) {
    if (segment.bucket === "SCHEDULED_NON_PRODUCTION") {
      plannedExclusionSources.push({
        id: `planned-exclusion:${index}`,
        sourceType: "SCHEDULED_EXCLUSION",
        bucket: "SCHEDULED_NON_PRODUCTION",
        start: segment.start,
        end: segment.end,
      });
    }
    if (segment.bucket === "PLANNED_MAINTENANCE") {
      plannedExclusionSources.push({
        id: `planned-maintenance:${index}`,
        sourceType: "PLANNED_MAINTENANCE",
        bucket: "PLANNED_MAINTENANCE",
        start: segment.start,
        end: segment.end,
      });
    }
  }
  const sources = [
    ...executionEventsToIntervals(input.executionEvents),
    ...downtimeIntervals,
    ...qualityHoldIntervals,
    ...plannedExclusionSources,
  ];
  const timeline = normalizeOeeTimeline({
    from: input.from,
    to: input.to,
    asOf: input.asOf,
    sources,
  });
  const idealCycleByOperation = new Map(input.operations.map((operation) => [operation.id, operation.idealCycleTimeSec]));

  let idealProductionTimeSeconds: number | null = 0;
  let totalCount = 0;
  let goodCount = 0;
  let scrapCount = 0;
  let reworkCount = 0;
  for (const report of input.reports) {
    const firstPassQuantity = report.goodQty + report.scrapQty;
    const idealCycleTimeSec = idealCycleByOperation.get(report.operationId);
    if (idealCycleTimeSec === null || idealCycleTimeSec === undefined) {
      idealProductionTimeSeconds = null;
    } else if (idealProductionTimeSeconds !== null) {
      idealProductionTimeSeconds += firstPassQuantity * idealCycleTimeSec;
    }
    totalCount += firstPassQuantity;
    goodCount += report.goodQty;
    scrapCount += report.scrapQty;
    reworkCount += report.reworkQty;
  }

  return {
    plannedTime,
    timeline,
    sources,
    metrics: calculateOeeMetrics({
      plannedProductionTimeSeconds: plannedTime.plannedProductionTimeSeconds,
      runTimeSeconds: timeline.durationByBucket.RUNNING,
      idealProductionTimeSeconds,
      totalCount,
      goodCount,
      scrapCount,
      reworkCount,
    }),
  };
}

type CalendarWindow = {
  id: string;
  start: Date | null;
  end: Date | null;
  breaks: readonly {
    id: string;
    start: Date | null;
    end: Date | null;
    isValidWithinShift: boolean;
  }[];
};

function numeric(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value);
}

function utcDateKeysIncludingAdjacentDays(from: Date, to: Date): string[] {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1));
  const dates: string[] = [];
  for (const cursor = start; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * On-demand canonical OEE authority. It obtains all first-slice facts from one
 * PostgreSQL repeatable-read snapshot; optional CMMS/QMS/loss enrichment is
 * intentionally added in its dedicated source-classification slice.
 */
@Injectable()
export class OeeCalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productionCalendar: ProductionCalendarService,
    private readonly synchronization?: OeeSnapshotSynchronization,
  ) {}

  async calculate(request: OeeCalculationRequest): Promise<CanonicalOeeCalculation> {
    const cutoff = new Date(Math.min(request.to.getTime(), request.asOf.getTime()));

    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      const workOrders = await db.workOrder.findMany({
        where: {
          tenantId: request.tenantId,
          plantId: request.plantId,
          ...(request.workOrderId ? { id: request.workOrderId } : {}),
          createdAt: { lte: cutoff },
          plannedStartDate: { not: null, lt: cutoff },
          plannedEndDate: { not: null, gt: request.from },
        },
        select: {
          id: true,
          plannedStartDate: true,
          plannedEndDate: true,
          operations: { select: { id: true, idealCycleTimeSec: true } },
        },
      });
      await this.synchronization?.reached("SNAPSHOT_ESTABLISHED");
      const operationIds = workOrders.flatMap((workOrder: { operations: { id: string }[] }) => workOrder.operations.map((operation) => operation.id));
      const workOrderIds = workOrders.map((workOrder: { id: string }) => workOrder.id);
      const [executionEvents, reports, downtimeEvents, qualityHolds] = await Promise.all([
        db.productionExecutionEvent.findMany({
          where: { tenantId: request.tenantId, operationId: { in: operationIds }, createdAt: { lte: cutoff } },
          select: { id: true, operationId: true, type: true, reasonCode: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        db.productionReport.findMany({
          where: { tenantId: request.tenantId, operationId: { in: operationIds }, createdAt: { lte: cutoff } },
          select: { id: true, operationId: true, goodQty: true, scrapQty: true, reworkQty: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        db.downtimeEvent.findMany({
          where: {
            tenantId: request.tenantId,
            workOrderId: { in: workOrderIds },
            createdAt: { lte: cutoff },
            startedAt: { lt: cutoff },
            OR: [{ endedAt: null }, { endedAt: { gt: request.from } }],
          },
          select: {
            id: true,
            startedAt: true,
            endedAt: true,
            source: true,
            ownership: true,
            maintenanceCategory: true,
            reason: { select: { id: true, code: true, label: true, category: true, lossCategory: true } },
          },
          orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        }),
        db.qualityHold.findMany({
          where: {
            tenantId: request.tenantId,
            workOrderId: { in: workOrderIds },
            createdAt: { lte: cutoff },
            OR: [{ releasedAt: null }, { releasedAt: { gt: request.from } }],
          },
          select: {
            id: true,
            workOrderId: true,
            operationId: true,
            lotId: true,
            inspectionLotId: true,
            quantity: true,
            reason: true,
            source: true,
            status: true,
            createdAt: true,
            releasedAt: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      ]);
      const calendarWindows = (await Promise.all(
        utcDateKeysIncludingAdjacentDays(request.from, cutoff).map((productionDate) =>
          this.productionCalendar.shiftWindowsForProductionDate(request.tenantId, request.plantId, productionDate, transaction as never),
        ),
      )).flat() as CalendarWindow[];
      const shiftIntervals = calendarWindows.flatMap((shift, index) =>
        shift.start && shift.end ? [{ id: `${shift.id}:${index}`, start: shift.start, end: shift.end }] : [],
      );
      const scheduledExclusions = calendarWindows.flatMap((shift, shiftIndex) =>
        shift.breaks.flatMap((item, breakIndex) =>
          item.isValidWithinShift && item.start && item.end
            ? [{ id: `${item.id}:${shiftIndex}:${breakIndex}`, start: item.start, end: item.end }]
            : [],
        ),
      );

      return calculateOeeFromCanonicalSources({
        from: request.from,
        to: request.to,
        asOf: request.asOf,
        scheduleIntervals: workOrders.flatMap((workOrder: { id: string; plannedStartDate: Date | null; plannedEndDate: Date | null }) =>
          workOrder.plannedStartDate && workOrder.plannedEndDate
            ? [{ id: workOrder.id, start: workOrder.plannedStartDate, end: workOrder.plannedEndDate }]
            : [],
        ),
        shiftIntervals,
        scheduledExclusions,
        plannedDowntime: [],
        operations: workOrders.flatMap((workOrder: { operations: { id: string; idealCycleTimeSec: unknown }[] }) =>
          workOrder.operations.map((operation) => ({
            id: operation.id,
            idealCycleTimeSec: operation.idealCycleTimeSec === null ? null : numeric(operation.idealCycleTimeSec),
          })),
        ),
        executionEvents: executionEvents.map((event: { id: string; operationId: string; type: string; reasonCode: string | null; createdAt: Date }) => ({
          id: event.id,
          operationId: event.operationId,
          eventType: event.type as OeeExecutionEvent["eventType"],
          reasonCode: event.reasonCode,
          createdAt: event.createdAt,
        })),
        reports: reports.map((report: { id: string; operationId: string; goodQty: unknown; scrapQty: unknown; reworkQty: unknown }) => ({
          id: report.id,
          operationId: report.operationId,
          goodQty: numeric(report.goodQty),
          scrapQty: numeric(report.scrapQty),
          reworkQty: numeric(report.reworkQty),
        })),
        downtimeIntervals: downtimeEventsToIntervals(downtimeEvents as OeeDowntimeEvent[]),
        qualityHoldIntervals: qualityHoldsToIntervals(qualityHolds as OeeQualityHold[]),
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 5_000,
      timeout: 60_000,
    });
  }

  /**
   * Produces work-order projections from one repeatable-read snapshot. This is
   * intentionally separate from plant aggregation: per-work-order schedule
   * intervals must not be summed to derive a plant-level OEE denominator.
   */
  async calculateForWorkOrders(
    request: OeeCalculationRequest,
    workOrderIds: readonly string[],
  ): Promise<Map<string, CanonicalOeeCalculation>> {
    const ids = [...new Set(workOrderIds)];
    if (ids.length === 0) return new Map();
    const cutoff = new Date(Math.min(request.to.getTime(), request.asOf.getTime()));

    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      const workOrders = await db.workOrder.findMany({
        where: {
          tenantId: request.tenantId,
          plantId: request.plantId,
          id: { in: ids },
          createdAt: { lte: cutoff },
          plannedStartDate: { not: null, lt: cutoff },
          plannedEndDate: { not: null, gt: request.from },
        },
        select: {
          id: true,
          plannedStartDate: true,
          plannedEndDate: true,
          operations: { select: { id: true, idealCycleTimeSec: true } },
        },
      });
      await this.synchronization?.reached("SNAPSHOT_ESTABLISHED");
      const operationIds = workOrders.flatMap((workOrder: { operations: { id: string }[] }) => workOrder.operations.map((operation) => operation.id));
      const loadedWorkOrderIds = workOrders.map((workOrder: { id: string }) => workOrder.id);
      const [executionEvents, reports, downtimeEvents, qualityHolds] = await Promise.all([
        db.productionExecutionEvent.findMany({
          where: { tenantId: request.tenantId, operationId: { in: operationIds }, createdAt: { lte: cutoff } },
          select: { id: true, operationId: true, type: true, reasonCode: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        db.productionReport.findMany({
          where: { tenantId: request.tenantId, operationId: { in: operationIds }, createdAt: { lte: cutoff } },
          select: { id: true, operationId: true, goodQty: true, scrapQty: true, reworkQty: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        db.downtimeEvent.findMany({
          where: {
            tenantId: request.tenantId,
            workOrderId: { in: loadedWorkOrderIds },
            createdAt: { lte: cutoff },
            startedAt: { lt: cutoff },
            OR: [{ endedAt: null }, { endedAt: { gt: request.from } }],
          },
          select: {
            id: true, workOrderId: true, startedAt: true, endedAt: true, source: true, ownership: true,
            maintenanceCategory: true,
            reason: { select: { id: true, code: true, label: true, category: true, lossCategory: true } },
          },
          orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        }),
        db.qualityHold.findMany({
          where: {
            tenantId: request.tenantId,
            workOrderId: { in: loadedWorkOrderIds },
            createdAt: { lte: cutoff },
            OR: [{ releasedAt: null }, { releasedAt: { gt: request.from } }],
          },
          select: {
            id: true, workOrderId: true, operationId: true, lotId: true, inspectionLotId: true, quantity: true,
            reason: true, source: true, status: true, createdAt: true, releasedAt: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      ]);
      const calendarWindows = (await Promise.all(
        utcDateKeysIncludingAdjacentDays(request.from, cutoff).map((productionDate) =>
          this.productionCalendar.shiftWindowsForProductionDate(request.tenantId, request.plantId, productionDate, transaction as never),
        ),
      )).flat() as CalendarWindow[];
      const shiftIntervals = calendarWindows.flatMap((shift, index) =>
        shift.start && shift.end ? [{ id: `${shift.id}:${index}`, start: shift.start, end: shift.end }] : [],
      );
      const scheduledExclusions = calendarWindows.flatMap((shift, shiftIndex) =>
        shift.breaks.flatMap((item, breakIndex) =>
          item.isValidWithinShift && item.start && item.end
            ? [{ id: `${item.id}:${shiftIndex}:${breakIndex}`, start: item.start, end: item.end }]
            : [],
        ),
      );
      const calculateOne = (scopedWorkOrders: readonly any[]): CanonicalOeeCalculation => {
        const scopedWorkOrderIds = new Set(scopedWorkOrders.map((workOrder) => workOrder.id));
        const scopedOperations = scopedWorkOrders.flatMap((workOrder) => workOrder.operations);
        const scopedOperationIds = new Set(scopedOperations.map((operation: { id: string }) => operation.id));
        return calculateOeeFromCanonicalSources({
          from: request.from,
          to: request.to,
          asOf: request.asOf,
          scheduleIntervals: scopedWorkOrders.flatMap((workOrder) =>
            workOrder.plannedStartDate && workOrder.plannedEndDate
              ? [{ id: workOrder.id, start: workOrder.plannedStartDate, end: workOrder.plannedEndDate }]
              : [],
          ),
          shiftIntervals,
          scheduledExclusions,
          plannedDowntime: [],
          operations: scopedOperations.map((operation: { id: string; idealCycleTimeSec: unknown }) => ({
            id: operation.id,
            idealCycleTimeSec: operation.idealCycleTimeSec === null ? null : numeric(operation.idealCycleTimeSec),
          })),
          executionEvents: executionEvents.filter((event: { operationId: string }) => scopedOperationIds.has(event.operationId)).map((event: { id: string; operationId: string; type: string; reasonCode: string | null; createdAt: Date }) => ({
            id: event.id, operationId: event.operationId, eventType: event.type as OeeExecutionEvent["eventType"], reasonCode: event.reasonCode, createdAt: event.createdAt,
          })),
          reports: reports.filter((report: { operationId: string }) => scopedOperationIds.has(report.operationId)).map((report: { id: string; operationId: string; goodQty: unknown; scrapQty: unknown; reworkQty: unknown }) => ({
            id: report.id, operationId: report.operationId, goodQty: numeric(report.goodQty), scrapQty: numeric(report.scrapQty), reworkQty: numeric(report.reworkQty),
          })),
          downtimeIntervals: downtimeEventsToIntervals(downtimeEvents.filter((event: { workOrderId: string }) => scopedWorkOrderIds.has(event.workOrderId)) as OeeDowntimeEvent[]),
          qualityHoldIntervals: qualityHoldsToIntervals(qualityHolds.filter((hold: { workOrderId: string }) => scopedWorkOrderIds.has(hold.workOrderId)) as OeeQualityHold[]),
        });
      };

      const byWorkOrder = new Map<string, CanonicalOeeCalculation>(workOrders.map((workOrder: any): readonly [string, CanonicalOeeCalculation] => [workOrder.id, calculateOne([workOrder])]));
      const emptyCalculation = calculateOne([]);
      return new Map<string, CanonicalOeeCalculation>(ids.map((id) => [id, byWorkOrder.get(id) ?? emptyCalculation] as const));
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 5_000,
      timeout: 60_000,
    });
  }
}
