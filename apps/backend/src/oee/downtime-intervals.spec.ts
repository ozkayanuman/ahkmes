import { downtimeEventsToIntervals } from "./downtime-intervals";

const at = (value: string) => new Date(value);

describe("downtimeEventsToIntervals", () => {
  it("uses the explicit OEE loss mapping and preserves reason provenance", () => {
    const intervals = downtimeEventsToIntervals([
      {
        id: "downtime-1",
        startedAt: at("2026-08-26T08:15:00.000Z"),
        endedAt: at("2026-08-26T08:45:00.000Z"),
        source: "ALARM",
        ownership: "MES",
        maintenanceCategory: null,
        reason: { id: "reason-1", code: "SPINDLE", label: "Spindle failure", category: "UNPLANNED", lossCategory: "UNPLANNED_BREAKDOWN" },
      },
    ]);

    expect(intervals).toEqual([
      expect.objectContaining({
        id: "downtime:downtime-1",
        sourceType: "DOWNTIME_EVENT",
        bucket: "UNPLANNED_BREAKDOWN",
        start: at("2026-08-26T08:15:00.000Z"),
        end: at("2026-08-26T08:45:00.000Z"),
        provenance: expect.objectContaining({ eventId: "downtime-1", reasonId: "reason-1", reasonCode: "SPINDLE", reasonLabel: "Spindle failure" }),
      }),
    ]);
  });

  it("falls back deterministically and keeps open downtime intervals open for the shared asOf cutoff", () => {
    const intervals = downtimeEventsToIntervals([
      {
        id: "downtime-2",
        startedAt: at("2026-08-26T08:30:00.000Z"),
        endedAt: null,
        source: "MANUAL",
        ownership: "MES",
        maintenanceCategory: null,
        reason: { id: "reason-2", code: "BREAK", label: "Break", category: "PLANNED", lossCategory: null },
      },
    ]);

    expect(intervals[0]).toMatchObject({ id: "downtime:downtime-2", bucket: "OTHER_PLANNED", end: null });
  });
});
