import { resolvePlannedProductionTime } from "./planned-time";

const at = (value: string) => new Date(value);
const input = () => ({
  from: at("2026-08-26T06:00:00.000Z"),
  to: at("2026-08-26T16:00:00.000Z"),
  asOf: at("2026-08-26T16:00:00.000Z"),
  scheduleIntervals: [{ id: "wo-1", start: at("2026-08-26T08:00:00.000Z"), end: at("2026-08-26T16:00:00.000Z") }],
  shiftIntervals: [{ id: "shift-1", start: at("2026-08-26T06:00:00.000Z"), end: at("2026-08-26T14:00:00.000Z") }],
  scheduledExclusions: [],
  plannedDowntime: [],
});

describe("resolvePlannedProductionTime", () => {
  it("does not create planned production time from a shift alone", () => {
    const result = resolvePlannedProductionTime({ ...input(), scheduleIntervals: [] });

    expect(result.plannedProductionTimeSeconds).toBeNull();
    expect(result.issues).toEqual([expect.objectContaining({ code: "MISSING_PLANNED_SCHEDULE" })]);
  });

  it("intersects explicit production planning with canonical shift windows", () => {
    const result = resolvePlannedProductionTime(input());

    expect(result.scheduledProductionTimeSeconds).toBe(6 * 3_600);
    expect(result.plannedProductionTimeSeconds).toBe(6 * 3_600);
    expect(result.issues).toEqual([]);
  });

  it("unions overlapping work-order plans instead of double-counting machine time", () => {
    const result = resolvePlannedProductionTime({
      ...input(),
      scheduleIntervals: [
        { id: "wo-1", start: at("2026-08-26T08:00:00.000Z"), end: at("2026-08-26T12:00:00.000Z") },
        { id: "wo-2", start: at("2026-08-26T10:00:00.000Z"), end: at("2026-08-26T14:00:00.000Z") },
      ],
    });

    expect(result.scheduledProductionTimeSeconds).toBe(6 * 3_600);
  });

  it("subtracts overlapping break and planned maintenance once using canonical precedence", () => {
    const result = resolvePlannedProductionTime({
      ...input(),
      scheduledExclusions: [{ id: "break", start: at("2026-08-26T10:00:00.000Z"), end: at("2026-08-26T10:30:00.000Z") }],
      plannedDowntime: [{ id: "pm", start: at("2026-08-26T10:15:00.000Z"), end: at("2026-08-26T10:45:00.000Z") }],
    });

    expect(result.scheduledNonProductionSeconds).toBe(30 * 60);
    expect(result.plannedDowntimeSeconds).toBe(15 * 60);
    expect(result.plannedProductionTimeSeconds).toBe(6 * 3_600 - 45 * 60);
    expect(result.segments.filter((segment) => segment.bucket !== "PLANNED_PRODUCTION").flatMap((segment) => segment.sourceIds)).toEqual(expect.arrayContaining(["break", "pm"]));
  });

  it("caps schedules and exclusions at the calculation's single asOf", () => {
    const result = resolvePlannedProductionTime({
      ...input(),
      asOf: at("2026-08-26T12:00:00.000Z"),
      plannedDowntime: [{ id: "pm-open", start: at("2026-08-26T11:30:00.000Z"), end: null }],
    });

    expect(result.cutoff).toEqual(at("2026-08-26T12:00:00.000Z"));
    expect(result.scheduledProductionTimeSeconds).toBe(4 * 3_600);
    expect(result.plannedDowntimeSeconds).toBe(30 * 60);
    expect(result.plannedProductionTimeSeconds).toBe(3.5 * 3_600);
  });

  it("reports factual no-scheduled-production instead of assuming a denominator", () => {
    const result = resolvePlannedProductionTime({
      ...input(),
      scheduleIntervals: [{ id: "wo-outside", start: at("2026-08-26T14:00:00.000Z"), end: at("2026-08-26T16:00:00.000Z") }],
    });

    expect(result.plannedProductionTimeSeconds).toBe(0);
    expect(result.issues).toEqual([expect.objectContaining({ code: "NO_SCHEDULED_PRODUCTION" })]);
  });
});
