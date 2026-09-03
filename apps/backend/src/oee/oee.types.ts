export const OEE_TIME_BUCKETS = [
  "SCHEDULED_NON_PRODUCTION",
  "PLANNED_MAINTENANCE",
  "UNPLANNED_BREAKDOWN",
  "QUALITY_HOLD",
  "MATERIAL_SHORTAGE",
  "SETUP_CHANGEOVER",
  "OPERATOR_RESOURCE_PAUSE",
  "OTHER_PLANNED",
  "OTHER_UNPLANNED",
  "RUNNING",
  "IDLE_STOPPED",
] as const;

export type OeeTimeBucket = (typeof OEE_TIME_BUCKETS)[number];

export type OeeSourceInterval = {
  id: string;
  sourceType: string;
  bucket: Exclude<OeeTimeBucket, "IDLE_STOPPED">;
  start: Date;
  end: Date | null;
  provenance?: Record<string, unknown>;
};

export type NormalizeTimelineInput = {
  from: Date;
  to: Date;
  asOf: Date;
  sources: readonly OeeSourceInterval[];
};

export type NormalizedOeeSegment = {
  start: Date;
  end: Date;
  durationSeconds: number;
  bucket: OeeTimeBucket;
  sourceIds: string[];
};

export type NormalizedOeeTimeline = {
  from: Date;
  to: Date;
  cutoff: Date;
  totalSeconds: number;
  durationByBucket: Record<OeeTimeBucket, number>;
  segments: NormalizedOeeSegment[];
};

export const OEE_DATA_QUALITY_STATUSES = [
  "COMPLETE",
  "PARTIAL",
  "INSUFFICIENT_DATA",
  "MISSING_STANDARD",
  "STALE_SOURCE",
] as const;

export type OeeDataQualityStatus = (typeof OEE_DATA_QUALITY_STATUSES)[number];

export type OeeDataQualityIssue = {
  code: string;
  status: Exclude<OeeDataQualityStatus, "COMPLETE">;
  message: string;
  sourceIds?: string[];
};
