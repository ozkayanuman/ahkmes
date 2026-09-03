import { executionEventsToIntervals } from "./execution-intervals";

type EventType = Parameters<typeof executionEventsToIntervals>[0][number]["eventType"];

const event = (id: string, eventType: EventType, minute: number, reasonCode?: string) => ({
  id,
  operationId: "op-1",
  eventType,
  reasonCode: reasonCode ?? null,
  createdAt: new Date(`2026-08-26T08:${String(minute).padStart(2, "0")}:00.000Z`),
});

describe("executionEventsToIntervals", () => {
  it("closes productive running at PAUSE and resumes only at RESUME", () => {
    const intervals = executionEventsToIntervals([
      event("start", "START", 0),
      event("pause", "PAUSE", 10, "OPERATOR_BREAK"),
      event("resume", "RESUME", 25),
      event("complete", "COMPLETE", 40),
    ]);

    expect(intervals).toEqual([
      expect.objectContaining({ bucket: "RUNNING", start: new Date("2026-08-26T08:00:00.000Z"), end: new Date("2026-08-26T08:10:00.000Z") }),
      expect.objectContaining({ bucket: "OPERATOR_RESOURCE_PAUSE", start: new Date("2026-08-26T08:10:00.000Z"), end: new Date("2026-08-26T08:25:00.000Z") }),
      expect.objectContaining({ bucket: "RUNNING", start: new Date("2026-08-26T08:25:00.000Z"), end: new Date("2026-08-26T08:40:00.000Z") }),
    ]);
  });

  it("classifies durable hold reason evidence without calling every hold a breakdown", () => {
    const quality = executionEventsToIntervals([
      event("start", "START", 0),
      event("hold", "HOLD", 5, "QUALITY_HOLD"),
      event("release", "HOLD_RELEASE", 20),
      event("complete", "COMPLETE", 30),
    ]);
    const shortage = executionEventsToIntervals([
      event("start-2", "START", 0),
      event("hold-2", "HOLD", 5, "MATERIAL_SHORTAGE"),
      event("release-2", "HOLD_RELEASE", 20),
    ]);

    expect(quality.find((interval) => interval.id === "hold:QUALITY_HOLD")?.bucket).toBe("QUALITY_HOLD");
    expect(shortage.find((interval) => interval.id === "hold-2:MATERIAL_SHORTAGE")?.bucket).toBe("MATERIAL_SHORTAGE");
    expect(quality.some((interval) => interval.bucket === "UNPLANNED_BREAKDOWN")).toBe(false);
  });

  it("keeps setup outside productive running and does not auto-start after setup complete", () => {
    const intervals = executionEventsToIntervals([
      event("setup-start", "SETUP_START", 0),
      event("setup-complete", "SETUP_COMPLETE", 15),
      event("start", "START", 20),
      event("complete", "COMPLETE", 30),
    ]);

    expect(intervals).toEqual([
      expect.objectContaining({ bucket: "SETUP_CHANGEOVER", start: new Date("2026-08-26T08:00:00.000Z"), end: new Date("2026-08-26T08:15:00.000Z") }),
      expect.objectContaining({ bucket: "RUNNING", start: new Date("2026-08-26T08:20:00.000Z"), end: new Date("2026-08-26T08:30:00.000Z") }),
    ]);
  });

  it("leaves current running and hold intervals open for the normalizer's single asOf", () => {
    const running = executionEventsToIntervals([event("start", "START", 0)]);
    const held = executionEventsToIntervals([event("start-2", "START", 0), event("hold", "HOLD", 10, "QUALITY_HOLD")]);

    expect(running).toEqual([expect.objectContaining({ bucket: "RUNNING", end: null })]);
    expect(held.at(-1)).toEqual(expect.objectContaining({ bucket: "QUALITY_HOLD", end: null }));
  });

  it("keeps rework execution time but does not invent an additional quantity report", () => {
    const intervals = executionEventsToIntervals([
      event("rework-start", "REWORK_START", 0),
      event("report", "REPORT", 10),
      event("rework-complete", "REWORK_COMPLETE", 20),
    ]);

    expect(intervals).toEqual([
      expect.objectContaining({ bucket: "RUNNING", start: new Date("2026-08-26T08:00:00.000Z"), end: new Date("2026-08-26T08:20:00.000Z"), provenance: expect.objectContaining({ executionMode: "REWORK" }) }),
    ]);
  });
});
