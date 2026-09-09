import type { OeeSourceInterval } from "./oee.types";

export type OeeQualityHold = {
  id: string;
  workOrderId: string | null;
  operationId: string | null;
  lotId: string | null;
  inspectionLotId: string | null;
  quantity: unknown;
  reason: string;
  source: string;
  status: "ACTIVE" | "RELEASED";
  createdAt: Date;
  releasedAt: Date | null;
};

function quantityValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "object" && "toNumber" in (value as object) && typeof (value as { toNumber?: unknown }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Converts QualityHold lifecycle evidence to explainable OEE quality-loss intervals. */
export function qualityHoldsToIntervals(holds: readonly OeeQualityHold[]): OeeSourceInterval[] {
  return holds
    .map((hold) => ({
      id: `quality-hold:${hold.id}`,
      sourceType: "QUALITY_HOLD",
      bucket: "QUALITY_HOLD" as const,
      start: hold.createdAt,
      end: hold.releasedAt,
      provenance: {
        holdId: hold.id,
        workOrderId: hold.workOrderId,
        operationId: hold.operationId,
        lotId: hold.lotId,
        inspectionLotId: hold.inspectionLotId,
        quantity: quantityValue(hold.quantity),
        reason: hold.reason,
        source: hold.source,
        status: hold.status,
      },
    }))
    .sort((left, right) => left.start.getTime() - right.start.getTime() || left.id.localeCompare(right.id));
}
