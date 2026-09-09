import type { OeeSourceInterval, OeeTimeBucket } from "./oee.types";

export const OEE_EXECUTION_EVENT_TYPES = [
  "SETUP_START",
  "SETUP_COMPLETE",
  "START",
  "PAUSE",
  "RESUME",
  "HOLD",
  "HOLD_RELEASE",
  "REPORT",
  "COMPLETE",
  "REWORK_START",
  "REWORK_COMPLETE",
] as const;

export type OeeExecutionEventType = (typeof OEE_EXECUTION_EVENT_TYPES)[number];

export type OeeExecutionEvent = {
  id: string;
  operationId: string;
  eventType: OeeExecutionEventType;
  reasonCode: string | null;
  createdAt: Date;
};

type LossBucket = Exclude<OeeTimeBucket, "RUNNING" | "IDLE_STOPPED" | "SCHEDULED_NON_PRODUCTION" | "PLANNED_MAINTENANCE">;

function classifiedLoss(reasonCode: string | null, fallback: LossBucket): LossBucket {
  const reason = reasonCode?.trim().toUpperCase() ?? "";
  if (reason.includes("QUALITY")) return "QUALITY_HOLD";
  if (reason.includes("MATERIAL") || reason.includes("SHORTAGE")) return "MATERIAL_SHORTAGE";
  if (reason.includes("BREAKDOWN") || reason.includes("FAILURE")) return "UNPLANNED_BREAKDOWN";
  if (reason.includes("SETUP") || reason.includes("CHANGEOVER")) return "SETUP_CHANGEOVER";
  if (reason.includes("OPERATOR") || reason.includes("RESOURCE") || reason.includes("NO_OPERATOR")) return "OPERATOR_RESOURCE_PAUSE";
  if (reason.includes("PLANNED")) return "OTHER_PLANNED";
  return fallback;
}

type OpenExecutionInterval = {
  event: OeeExecutionEvent;
  bucket: OeeSourceInterval["bucket"];
  executionMode: "PRODUCTION" | "REWORK";
};

function materialize(open: OpenExecutionInterval, end: Date | null): OeeSourceInterval {
  return {
    id: `${open.event.id}:${open.bucket}`,
    sourceType: "MES_EXECUTION_EVENT",
    bucket: open.bucket,
    start: open.event.createdAt,
    end,
    provenance: {
      eventId: open.event.id,
      operationId: open.event.operationId,
      reasonCode: open.event.reasonCode,
      executionMode: open.executionMode,
    },
  };
}

/** Reconstructs MES lifecycle intervals without using ProductionRun wall-clock duration. */
export function executionEventsToIntervals(events: readonly OeeExecutionEvent[]): OeeSourceInterval[] {
  const byOperation = new Map<string, OeeExecutionEvent[]>();
  for (const event of events) {
    const list = byOperation.get(event.operationId) ?? [];
    list.push(event);
    byOperation.set(event.operationId, list);
  }

  const result: OeeSourceInterval[] = [];
  for (const operationEvents of byOperation.values()) {
    operationEvents.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
    let open: OpenExecutionInterval | null = null;
    const close = (end: Date) => {
      if (open && end.getTime() > open.event.createdAt.getTime()) result.push(materialize(open, end));
      open = null;
    };

    for (const event of operationEvents) {
      switch (event.eventType) {
        case "SETUP_START":
          close(event.createdAt);
          open = { event, bucket: "SETUP_CHANGEOVER", executionMode: "PRODUCTION" };
          break;
        case "SETUP_COMPLETE":
          close(event.createdAt);
          break;
        case "START":
        case "RESUME":
          close(event.createdAt);
          open = { event, bucket: "RUNNING", executionMode: "PRODUCTION" };
          break;
        case "REWORK_START":
          close(event.createdAt);
          open = { event, bucket: "RUNNING", executionMode: "REWORK" };
          break;
        case "PAUSE":
          close(event.createdAt);
          open = { event, bucket: classifiedLoss(event.reasonCode, "OPERATOR_RESOURCE_PAUSE"), executionMode: "PRODUCTION" };
          break;
        case "HOLD":
          close(event.createdAt);
          open = { event, bucket: classifiedLoss(event.reasonCode, "OTHER_UNPLANNED"), executionMode: "PRODUCTION" };
          break;
        case "HOLD_RELEASE":
          close(event.createdAt);
          open = { event, bucket: "RUNNING", executionMode: "PRODUCTION" };
          break;
        case "COMPLETE":
        case "REWORK_COMPLETE":
          close(event.createdAt);
          break;
        case "REPORT":
          break;
      }
    }

    if (open) result.push(materialize(open, null));
  }

  return result.sort((left, right) => left.start.getTime() - right.start.getTime() || left.id.localeCompare(right.id));
}
