import { normalizeOeeTimeline } from "./interval-normalizer";
import type { OeeSourceInterval } from "./oee.types";

const at = (value: string) => new Date(value);
const FROM = at("2026-08-26T08:00:00.000Z");
const TO = at("2026-08-26T09:00:00.000Z");

function source(
  id: string,
  bucket: OeeSourceInterval["bucket"],
  start: string,
  end: string | null,
): OeeSourceInterval {
  return {
    id,
    sourceType: "TEST",
    bucket,
    start: at(start),
    end: end ? at(end) : null,
  };
}

describe("normalizeOeeTimeline", () => {
  it("attributes an overlapping breakdown and hold once while retaining both sources", () => {
    const result = normalizeOeeTimeline({
      from: FROM,
      to: TO,
      asOf: TO,
      sources: [
        source("breakdown-1", "UNPLANNED_BREAKDOWN", "2026-08-26T08:15:00.000Z", "2026-08-26T08:45:00.000Z"),
        source("hold-1", "QUALITY_HOLD", "2026-08-26T08:15:00.000Z", "2026-08-26T08:45:00.000Z"),
      ],
    });

    expect(result.durationByBucket.UNPLANNED_BREAKDOWN).toBe(30 * 60);
    expect(result.durationByBucket.QUALITY_HOLD).toBe(0);
    expect(result.totalSeconds).toBe(60 * 60);
    const attributed = result.segments.find((segment) => segment.bucket === "UNPLANNED_BREAKDOWN");
    expect(attributed?.sourceIds).toEqual(["breakdown-1", "hold-1"]);
  });

  it("excludes a pause from productive run time", () => {
    const result = normalizeOeeTimeline({
      from: FROM,
      to: TO,
      asOf: TO,
      sources: [
        source("run-1", "RUNNING", "2026-08-26T08:00:00.000Z", "2026-08-26T09:00:00.000Z"),
        source("pause-1", "OPERATOR_RESOURCE_PAUSE", "2026-08-26T08:15:00.000Z", "2026-08-26T08:45:00.000Z"),
      ],
    });

    expect(result.durationByBucket.RUNNING).toBe(30 * 60);
    expect(result.durationByBucket.OPERATOR_RESOURCE_PAUSE).toBe(30 * 60);
  });

  it("does not count setup as productive run time", () => {
    const result = normalizeOeeTimeline({
      from: FROM,
      to: TO,
      asOf: TO,
      sources: [
        source("run-1", "RUNNING", "2026-08-26T08:00:00.000Z", "2026-08-26T09:00:00.000Z"),
        source("setup-1", "SETUP_CHANGEOVER", "2026-08-26T08:00:00.000Z", "2026-08-26T08:10:00.000Z"),
      ],
    });

    expect(result.durationByBucket.SETUP_CHANGEOVER).toBe(10 * 60);
    expect(result.durationByBucket.RUNNING).toBe(50 * 60);
  });

  it("caps every open source interval at the same asOf", () => {
    const asOf = at("2026-08-26T08:40:00.000Z");
    const result = normalizeOeeTimeline({
      from: FROM,
      to: TO,
      asOf,
      sources: [
        source("run-open", "RUNNING", "2026-08-26T08:00:00.000Z", null),
        source("hold-open", "QUALITY_HOLD", "2026-08-26T08:30:00.000Z", null),
      ],
    });

    expect(result.cutoff).toEqual(asOf);
    expect(result.totalSeconds).toBe(40 * 60);
    expect(result.durationByBucket.RUNNING).toBe(30 * 60);
    expect(result.durationByBucket.QUALITY_HOLD).toBe(10 * 60);
    expect(result.segments.at(-1)?.end).toEqual(asOf);
  });

  it("clips sources to the requested window and gives scheduled exclusion highest precedence", () => {
    const result = normalizeOeeTimeline({
      from: FROM,
      to: TO,
      asOf: TO,
      sources: [
        source("maintenance-1", "PLANNED_MAINTENANCE", "2026-08-26T07:30:00.000Z", "2026-08-26T08:30:00.000Z"),
        source("break-1", "SCHEDULED_NON_PRODUCTION", "2026-08-26T08:10:00.000Z", "2026-08-26T08:20:00.000Z"),
      ],
    });

    expect(result.durationByBucket.PLANNED_MAINTENANCE).toBe(20 * 60);
    expect(result.durationByBucket.SCHEDULED_NON_PRODUCTION).toBe(10 * 60);
    expect(result.totalSeconds).toBe(60 * 60);
  });

  it("conserves wall-clock duration across mutually exclusive buckets", () => {
    const result = normalizeOeeTimeline({
      from: FROM,
      to: TO,
      asOf: TO,
      sources: [
        source("run", "RUNNING", "2026-08-26T08:00:00.000Z", "2026-08-26T09:00:00.000Z"),
        source("breakdown", "UNPLANNED_BREAKDOWN", "2026-08-26T08:05:00.000Z", "2026-08-26T08:25:00.000Z"),
        source("shortage", "MATERIAL_SHORTAGE", "2026-08-26T08:20:00.000Z", "2026-08-26T08:35:00.000Z"),
        source("pause", "OPERATOR_RESOURCE_PAUSE", "2026-08-26T08:30:00.000Z", "2026-08-26T08:50:00.000Z"),
      ],
    });

    const attributedSeconds = Object.values(result.durationByBucket).reduce((sum, seconds) => sum + seconds, 0);
    expect(attributedSeconds).toBe(result.totalSeconds);
    expect(result.segments.every((segment) => segment.durationSeconds > 0)).toBe(true);
  });
});
