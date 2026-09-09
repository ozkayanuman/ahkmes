import {
  OEE_TIME_BUCKETS,
  type NormalizeTimelineInput,
  type NormalizedOeeSegment,
  type NormalizedOeeTimeline,
  type OeeSourceInterval,
  type OeeTimeBucket,
} from "./oee.types";

const PRECEDENCE: Record<OeeTimeBucket, number> = {
  SCHEDULED_NON_PRODUCTION: 0,
  PLANNED_MAINTENANCE: 1,
  UNPLANNED_BREAKDOWN: 2,
  QUALITY_HOLD: 3,
  MATERIAL_SHORTAGE: 4,
  SETUP_CHANGEOVER: 5,
  OPERATOR_RESOURCE_PAUSE: 6,
  OTHER_PLANNED: 7,
  OTHER_UNPLANNED: 8,
  RUNNING: 9,
  IDLE_STOPPED: 10,
};

type ClippedSource = OeeSourceInterval & { clippedStart: number; clippedEnd: number };

function emptyDurations(): Record<OeeTimeBucket, number> {
  return Object.fromEntries(OEE_TIME_BUCKETS.map((bucket) => [bucket, 0])) as Record<OeeTimeBucket, number>;
}

function assertValidDate(value: Date, label: string) {
  if (!Number.isFinite(value.getTime())) throw new RangeError(`${label} must be a valid timestamp`);
}

function sameSources(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Splits a wall-clock window at every source boundary and attributes each
 * atomic segment to exactly one mutually-exclusive OEE bucket. All active
 * source IDs remain attached to the attributed segment for explainability.
 */
export function normalizeOeeTimeline(input: NormalizeTimelineInput): NormalizedOeeTimeline {
  assertValidDate(input.from, "from");
  assertValidDate(input.to, "to");
  assertValidDate(input.asOf, "asOf");

  const fromMs = input.from.getTime();
  const cutoffMs = Math.min(input.to.getTime(), input.asOf.getTime());
  const cutoff = new Date(cutoffMs);
  const durationByBucket = emptyDurations();

  if (cutoffMs <= fromMs) {
    return {
      from: new Date(fromMs),
      to: new Date(input.to),
      cutoff,
      totalSeconds: 0,
      durationByBucket,
      segments: [],
    };
  }

  const sources: ClippedSource[] = input.sources.flatMap((source) => {
    assertValidDate(source.start, `source ${source.id} start`);
    if (source.end) assertValidDate(source.end, `source ${source.id} end`);
    const clippedStart = Math.max(fromMs, source.start.getTime());
    const clippedEnd = Math.min(cutoffMs, (source.end ?? cutoff).getTime());
    return clippedEnd > clippedStart ? [{ ...source, clippedStart, clippedEnd }] : [];
  });

  const boundaries = [...new Set([
    fromMs,
    cutoffMs,
    ...sources.flatMap((source) => [source.clippedStart, source.clippedEnd]),
  ])].sort((left, right) => left - right);

  const segments: NormalizedOeeSegment[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMs = boundaries[index]!;
    const endMs = boundaries[index + 1]!;
    if (endMs <= startMs) continue;

    const active = sources
      .filter((source) => source.clippedStart < endMs && source.clippedEnd > startMs)
      .sort((left, right) => PRECEDENCE[left.bucket] - PRECEDENCE[right.bucket] || left.id.localeCompare(right.id));
    const bucket: OeeTimeBucket = active[0]?.bucket ?? "IDLE_STOPPED";
    const sourceIds = active.map((source) => source.id).sort();
    const durationSeconds = (endMs - startMs) / 1000;
    durationByBucket[bucket] += durationSeconds;

    const previous = segments.at(-1);
    if (previous && previous.bucket === bucket && previous.end.getTime() === startMs && sameSources(previous.sourceIds, sourceIds)) {
      previous.end = new Date(endMs);
      previous.durationSeconds += durationSeconds;
    } else {
      segments.push({
        start: new Date(startMs),
        end: new Date(endMs),
        durationSeconds,
        bucket,
        sourceIds,
      });
    }
  }

  return {
    from: new Date(fromMs),
    to: new Date(input.to),
    cutoff,
    totalSeconds: (cutoffMs - fromMs) / 1000,
    durationByBucket,
    segments,
  };
}
