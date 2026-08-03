-- AHK-004: Recipe revizyonunu iş emrinde dondurur ve operasyon/WIP ilerlemesini
-- üretim koşularına bağlar. Eski iş emirleri rotasız kalır; veri uydurulmaz.
CREATE TYPE "WorkOrderOperationStatus" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'BLOCKED',
  'SKIPPED'
);

ALTER TABLE "WorkOrder"
  ADD COLUMN "recipeHeaderId" TEXT,
  ADD COLUMN "recipeRevision" TEXT,
  ADD COLUMN "routeSnapshotAt" TIMESTAMP(3);

CREATE TABLE "WorkOrderOperation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "parameterName" TEXT,
  "parameterValue" TEXT,
  "unit" TEXT,
  "machineId" TEXT,
  "status" "WorkOrderOperationStatus" NOT NULL DEFAULT 'PENDING',
  "completedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "scrapQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkOrderOperation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProductionRun" ADD COLUMN "operationId" TEXT;

CREATE UNIQUE INDEX "WorkOrderOperation_workOrderId_seq_key" ON "WorkOrderOperation"("workOrderId", "seq");
CREATE INDEX "WorkOrderOperation_tenantId_workOrderId_status_idx" ON "WorkOrderOperation"("tenantId", "workOrderId", "status");
CREATE INDEX "WorkOrderOperation_machineId_idx" ON "WorkOrderOperation"("machineId");
CREATE INDEX "ProductionRun_operationId_idx" ON "ProductionRun"("operationId");

ALTER TABLE "WorkOrderOperation"
  ADD CONSTRAINT "WorkOrderOperation_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WorkOrderOperation_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductionRun"
  ADD CONSTRAINT "ProductionRun_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
