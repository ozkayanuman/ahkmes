-- MRP II finite-capacity scheduling: operation-level planned windows written by
-- committed SchedulingRun snapshots. Simulated runs are never persisted.
CREATE TYPE "SchedulingDispatchRule" AS ENUM ('EDD', 'PRIORITY', 'FIFO', 'SPT');

CREATE TABLE "SchedulingRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plantId" TEXT,
    "dispatchRule" "SchedulingDispatchRule" NOT NULL,
    "horizonStart" TIMESTAMP(3) NOT NULL,
    "horizonEnd" TIMESTAMP(3) NOT NULL,
    "committed" BOOLEAN NOT NULL DEFAULT true,
    "scheduledOps" INTEGER NOT NULL,
    "unscheduledOps" INTEGER NOT NULL,
    "lateWorkOrders" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulingRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SchedulingRun_tenantId_createdAt_idx" ON "SchedulingRun"("tenantId", "createdAt");

ALTER TABLE "SchedulingRun"
  ADD CONSTRAINT "SchedulingRun_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkOrderOperation"
  ADD COLUMN "plannedStartAt" TIMESTAMP(3),
  ADD COLUMN "plannedEndAt" TIMESTAMP(3),
  ADD COLUMN "schedulingRunId" TEXT;

CREATE INDEX "WorkOrderOperation_tenantId_machineId_plannedStartAt_idx" ON "WorkOrderOperation"("tenantId", "machineId", "plannedStartAt");

ALTER TABLE "WorkOrderOperation"
  ADD CONSTRAINT "WorkOrderOperation_schedulingRunId_fkey"
  FOREIGN KEY ("schedulingRunId") REFERENCES "SchedulingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
