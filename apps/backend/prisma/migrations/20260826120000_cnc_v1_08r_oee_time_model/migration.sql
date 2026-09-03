-- CNC-V1-08R: immutable operation performance standards and canonical
-- recurring production-shift breaks. All additions are nullable/additive so
-- legacy operations remain readable and honestly report MISSING_STANDARD.
ALTER TABLE "RecipeStep" ADD COLUMN "idealCycleTimeSec" DECIMAL(18,6);
ALTER TABLE "WorkOrderOperation" ADD COLUMN "idealCycleTimeSec" DECIMAL(18,6);

CREATE UNIQUE INDEX "ProductionShift_id_tenantId_key"
  ON "ProductionShift"("id", "tenantId");

CREATE TABLE "ProductionShiftBreak" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionShiftBreak_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductionShiftBreak_tenantId_shiftId_startMinute_idx"
  ON "ProductionShiftBreak"("tenantId", "shiftId", "startMinute");

ALTER TABLE "ProductionShiftBreak"
  ADD CONSTRAINT "ProductionShiftBreak_shiftId_tenantId_fkey"
  FOREIGN KEY ("shiftId", "tenantId")
  REFERENCES "ProductionShift"("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;
