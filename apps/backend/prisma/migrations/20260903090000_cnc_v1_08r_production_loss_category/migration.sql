-- CNC-V1-08R Task 4: additive mapping for canonical OEE loss buckets.
-- Existing planned/unplanned classifications remain untouched; null means the
-- application must use the deterministic legacy fallback.
CREATE TYPE "ProductionLossCategory" AS ENUM (
  'PLANNED_MAINTENANCE',
  'UNPLANNED_BREAKDOWN',
  'QUALITY_HOLD',
  'MATERIAL_SHORTAGE',
  'SETUP_CHANGEOVER',
  'OPERATOR_RESOURCE_PAUSE',
  'OTHER_PLANNED',
  'OTHER_UNPLANNED'
);

ALTER TABLE "DowntimeReason"
  ADD COLUMN "lossCategory" "ProductionLossCategory";
