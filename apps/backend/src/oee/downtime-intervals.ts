import type { OeeSourceInterval, OeeTimeBucket } from "./oee.types";

type DowntimeBucket = Exclude<OeeTimeBucket, "RUNNING" | "IDLE_STOPPED" | "SCHEDULED_NON_PRODUCTION">;

export type OeeDowntimeEvent = {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  source: string;
  ownership: string;
  maintenanceCategory: "PLANNED_MAINTENANCE" | "UNPLANNED_BREAKDOWN" | "OTHER_MAINTENANCE" | null;
  reason: {
    id: string;
    code: string;
    label: string;
    category: "PLANNED" | "UNPLANNED";
    lossCategory: DowntimeBucket | null;
  } | null;
};

function bucketFor(event: OeeDowntimeEvent): DowntimeBucket {
  if (event.reason?.lossCategory) return event.reason.lossCategory;
  if (event.maintenanceCategory === "PLANNED_MAINTENANCE") return "PLANNED_MAINTENANCE";
  if (event.maintenanceCategory === "UNPLANNED_BREAKDOWN") return "UNPLANNED_BREAKDOWN";
  if (event.maintenanceCategory === "OTHER_MAINTENANCE") return "OTHER_PLANNED";
  if (event.reason?.category === "PLANNED") return "OTHER_PLANNED";
  return "OTHER_UNPLANNED";
}

/** Converts structured downtime evidence to explainable OEE loss intervals. */
export function downtimeEventsToIntervals(events: readonly OeeDowntimeEvent[]): OeeSourceInterval[] {
  return events
    .map((event) => ({
      id: `downtime:${event.id}`,
      sourceType: "DOWNTIME_EVENT",
      bucket: bucketFor(event),
      start: event.startedAt,
      end: event.endedAt,
      provenance: {
        eventId: event.id,
        source: event.source,
        ownership: event.ownership,
        maintenanceCategory: event.maintenanceCategory,
        reasonId: event.reason?.id ?? null,
        reasonCode: event.reason?.code ?? null,
        reasonLabel: event.reason?.label ?? null,
      },
    }))
    .sort((left, right) => left.start.getTime() - right.start.getTime() || left.id.localeCompare(right.id));
}
