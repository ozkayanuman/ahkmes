import { qualityHoldsToIntervals } from "./quality-hold-intervals";

const at = (value: string) => new Date(value);

describe("qualityHoldsToIntervals", () => {
  it("turns an active work-order hold into an open, explainable QUALITY_HOLD interval", () => {
    const intervals = qualityHoldsToIntervals([
      {
        id: "hold-1",
        workOrderId: "wo-1",
        operationId: "op-10",
        lotId: null,
        inspectionLotId: "inspection-lot-1",
        quantity: 25,
        reason: "Inspection failed",
        source: "INSPECTION_LOT",
        status: "ACTIVE",
        createdAt: at("2026-08-26T08:15:00.000Z"),
        releasedAt: null,
      },
    ]);

    expect(intervals).toEqual([
      expect.objectContaining({
        id: "quality-hold:hold-1",
        sourceType: "QUALITY_HOLD",
        bucket: "QUALITY_HOLD",
        start: at("2026-08-26T08:15:00.000Z"),
        end: null,
        provenance: expect.objectContaining({
          holdId: "hold-1",
          workOrderId: "wo-1",
          operationId: "op-10",
          inspectionLotId: "inspection-lot-1",
          quantity: 25,
          reason: "Inspection failed",
          source: "INSPECTION_LOT",
          status: "ACTIVE",
        }),
      }),
    ]);
  });

  it("keeps an immutable release timestamp as the hold interval end", () => {
    const intervals = qualityHoldsToIntervals([
      {
        id: "hold-2",
        workOrderId: "wo-1",
        operationId: null,
        lotId: null,
        inspectionLotId: null,
        quantity: null,
        reason: "Manual quality stop",
        source: "MANUAL",
        status: "RELEASED",
        createdAt: at("2026-08-26T08:30:00.000Z"),
        releasedAt: at("2026-08-26T08:45:00.000Z"),
      },
    ]);

    expect(intervals[0]).toMatchObject({
      id: "quality-hold:hold-2",
      bucket: "QUALITY_HOLD",
      end: at("2026-08-26T08:45:00.000Z"),
      provenance: expect.objectContaining({ status: "RELEASED", quantity: null }),
    });
  });
});
