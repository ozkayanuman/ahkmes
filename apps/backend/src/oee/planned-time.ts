import { normalizeOeeTimeline } from "./interval-normalizer";
import type { NormalizedOeeSegment, OeeDataQualityIssue, OeeSourceInterval } from "./oee.types";

type TimeInterval = {
  id: string;
  start: Date;
  end: Date | null;
};

export type ResolvePlannedProductionTimeInput = {
  from: Date;
  to: Date;
  asOf: Date;
  scheduleIntervals: readonly TimeInterval[];
  shiftIntervals: readonly TimeInterval[];
  scheduledExclusions: readonly TimeInterval[];
  plannedDowntime: readonly TimeInterval[];
};

export type PlannedProductionTime = {
  cutoff: Date;
  scheduledProductionTimeSeconds: number | null;
  scheduledNonProductionSeconds: number;
  plannedDowntimeSeconds: number;
  plannedProductionTimeSeconds: number | null;
  issues: OeeDataQualityIssue[];
  segments: PlannedProductionSegment[];
};

export type PlannedProductionSegment = Omit<NormalizedOeeSegment, "bucket"> & {
  bucket: "PLANNED_PRODUCTION" | "SCHEDULED_NON_PRODUCTION" | "PLANNED_MAINTENANCE";
};

function endAt(interval: TimeInterval, fallback: Date) {
  return interval.end ?? fallback;
}

function overlaps(left: TimeInterval, right: TimeInterval, fallback: Date) {
  return left.start.getTime() < endAt(right, fallback).getTime()
    && right.start.getTime() < endAt(left, fallback).getTime();
}

function intersection(left: TimeInterval, right: TimeInterval, fallback: Date): { start: Date; end: Date } | null {
  if (!overlaps(left, right, fallback)) return null;

  const start = new Date(Math.max(left.start.getTime(), right.start.getTime()));
  const end = new Date(Math.min(endAt(left, fallback).getTime(), endAt(right, fallback).getTime()));
  return end.getTime() > start.getTime() ? { start, end } : null;
}

function issue(code: string, message: string): OeeDataQualityIssue {
  return { code, status: "INSUFFICIENT_DATA", message };
}

function toPlannedProductionSegments(segments: readonly NormalizedOeeSegment[]): PlannedProductionSegment[] {
  const plannedSegments: PlannedProductionSegment[] = [];
  for (const segment of segments) {
    if (segment.bucket === "RUNNING") {
      plannedSegments.push({ ...segment, bucket: "PLANNED_PRODUCTION" });
    } else if (segment.bucket === "SCHEDULED_NON_PRODUCTION") {
      plannedSegments.push({ ...segment, bucket: "SCHEDULED_NON_PRODUCTION" });
    } else if (segment.bucket === "PLANNED_MAINTENANCE") {
      plannedSegments.push({ ...segment, bucket: "PLANNED_MAINTENANCE" });
    }
  }
  return plannedSegments;
}

/**
 * Resolves the OEE denominator from explicit work-order plans intersected with
 * canonical shift windows. Shifts alone never establish planned production.
 */
export function resolvePlannedProductionTime(input: ResolvePlannedProductionTimeInput): PlannedProductionTime {
  const cutoff = new Date(Math.min(input.to.getTime(), input.asOf.getTime()));
  const scheduledSources: OeeSourceInterval[] = input.scheduleIntervals.flatMap((schedule) =>
    input.shiftIntervals.flatMap((shift) => {
      const window = intersection(schedule, shift, cutoff);
      return window
        ? [{
            id: `schedule:${schedule.id}:shift:${shift.id}`,
            sourceType: "WORK_ORDER_SCHEDULE",
            bucket: "RUNNING" as const,
            ...window,
          }]
        : [];
    }),
  );

  if (input.scheduleIntervals.length === 0) {
    return {
      cutoff,
      scheduledProductionTimeSeconds: null,
      scheduledNonProductionSeconds: 0,
      plannedDowntimeSeconds: 0,
      plannedProductionTimeSeconds: null,
      issues: [issue("MISSING_PLANNED_SCHEDULE", "No explicit assigned work-order schedule is available for this OEE scope.")],
      segments: [],
    };
  }

  const scheduledTimeline = normalizeOeeTimeline({
    from: input.from,
    to: input.to,
    asOf: input.asOf,
    sources: scheduledSources,
  });
  const scheduledSegments = scheduledTimeline.segments.filter((segment) => segment.bucket === "RUNNING");
  const scheduledProductionTimeSeconds = scheduledTimeline.durationByBucket.RUNNING;

  if (scheduledProductionTimeSeconds === 0) {
    return {
      cutoff: scheduledTimeline.cutoff,
      scheduledProductionTimeSeconds,
      scheduledNonProductionSeconds: 0,
      plannedDowntimeSeconds: 0,
      plannedProductionTimeSeconds: 0,
      issues: [issue("NO_SCHEDULED_PRODUCTION", "Explicit work-order plans do not overlap the canonical shift windows in this range.")],
      segments: toPlannedProductionSegments(scheduledTimeline.segments),
    };
  }

  const scheduleCoverage: TimeInterval[] = scheduledSegments.map((segment, index) => ({
    id: `scheduled-coverage:${index}`,
    start: segment.start,
    end: segment.end,
  }));
  const coverageSources: OeeSourceInterval[] = scheduleCoverage.map((coverage) => ({
    id: coverage.id,
    sourceType: "WORK_ORDER_SCHEDULE",
    bucket: "RUNNING",
    start: coverage.start,
    end: coverage.end,
  }));

  const sourcesForCoverage = (
    intervals: readonly TimeInterval[],
    sourceType: string,
    bucket: "SCHEDULED_NON_PRODUCTION" | "PLANNED_MAINTENANCE",
  ) => intervals.flatMap((interval) =>
    scheduleCoverage.flatMap((coverage) => {
      const window = intersection(interval, coverage, cutoff);
      return window
        ? [{ id: interval.id, sourceType, bucket, ...window }]
        : [];
    }),
  );

  const timeline = normalizeOeeTimeline({
    from: input.from,
    to: input.to,
    asOf: input.asOf,
    sources: [
      ...coverageSources,
      ...sourcesForCoverage(input.scheduledExclusions, "SCHEDULED_EXCLUSION", "SCHEDULED_NON_PRODUCTION"),
      ...sourcesForCoverage(input.plannedDowntime, "PLANNED_MAINTENANCE", "PLANNED_MAINTENANCE"),
    ],
  });
  const scheduledNonProductionSeconds = timeline.durationByBucket.SCHEDULED_NON_PRODUCTION;
  const plannedDowntimeSeconds = timeline.durationByBucket.PLANNED_MAINTENANCE;

  return {
    cutoff: timeline.cutoff,
    scheduledProductionTimeSeconds,
    scheduledNonProductionSeconds,
    plannedDowntimeSeconds,
    plannedProductionTimeSeconds: scheduledProductionTimeSeconds - scheduledNonProductionSeconds - plannedDowntimeSeconds,
    issues: [],
    segments: toPlannedProductionSegments(timeline.segments),
  };
}
