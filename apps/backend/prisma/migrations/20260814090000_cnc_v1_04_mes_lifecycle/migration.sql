-- CNC-V1-04: one current execution state on WorkOrderOperation, with
-- append-only lifecycle and incremental production evidence.
ALTER TYPE "WorkOrderOperationStatus" ADD VALUE IF NOT EXISTS 'SETUP';
ALTER TYPE "WorkOrderOperationStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "WorkOrderOperationStatus" ADD VALUE IF NOT EXISTS 'HELD';
ALTER TYPE "WorkOrderOperationStatus" ADD VALUE IF NOT EXISTS 'REWORK';

CREATE TYPE "ProductionExecutionEventType" AS ENUM (
  'SETUP_START','SETUP_COMPLETE','START','PAUSE','RESUME','HOLD','HOLD_RELEASE','REPORT','COMPLETE','REWORK_START','REWORK_COMPLETE'
);

CREATE TABLE "ProductionExecutionEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "productionRunId" TEXT,
  "type" "ProductionExecutionEventType" NOT NULL,
  "reasonCode" TEXT,
  "note" TEXT,
  "shiftId" TEXT,
  "productionDate" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionExecutionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionExecutionEvent_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductionExecutionEvent_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductionExecutionEvent_productionRunId_fkey" FOREIGN KEY ("productionRunId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductionExecutionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id")
);
CREATE UNIQUE INDEX "ProductionExecutionEvent_tenantId_idempotencyKey_key" ON "ProductionExecutionEvent"("tenantId", "idempotencyKey");
CREATE INDEX "ProductionExecutionEvent_tenantId_operationId_createdAt_idx" ON "ProductionExecutionEvent"("tenantId", "operationId", "createdAt");

CREATE TABLE "ProductionReport" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "productionRunId" TEXT NOT NULL,
  "goodQty" DECIMAL(18,3) NOT NULL,
  "scrapQty" DECIMAL(18,3) NOT NULL,
  "reworkQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "reasonCode" TEXT,
  "note" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "reportedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionReport_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductionReport_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductionReport_productionRunId_fkey" FOREIGN KEY ("productionRunId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductionReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id")
);
CREATE UNIQUE INDEX "ProductionReport_tenantId_idempotencyKey_key" ON "ProductionReport"("tenantId", "idempotencyKey");
CREATE INDEX "ProductionReport_tenantId_operationId_createdAt_idx" ON "ProductionReport"("tenantId", "operationId", "createdAt");

-- Tenant ownership is an integrity property, not merely a service filter.
-- Keep the existing identity FKs for ORM compatibility and add composite
-- ownership FKs for every new lifecycle reference.
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_id_tenantId_key" UNIQUE ("id", "tenantId");
ALTER TABLE "ProductionExecutionEvent"
  ADD CONSTRAINT "ProductionExecutionEvent_workOrder_tenant_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId"),
  ADD CONSTRAINT "ProductionExecutionEvent_operation_tenant_fkey" FOREIGN KEY ("operationId", "tenantId") REFERENCES "WorkOrderOperation"("id", "tenantId"),
  ADD CONSTRAINT "ProductionExecutionEvent_run_tenant_fkey" FOREIGN KEY ("productionRunId", "tenantId") REFERENCES "ProductionRun"("id", "tenantId");
ALTER TABLE "ProductionReport"
  ADD CONSTRAINT "ProductionReport_workOrder_tenant_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId"),
  ADD CONSTRAINT "ProductionReport_operation_tenant_fkey" FOREIGN KEY ("operationId", "tenantId") REFERENCES "WorkOrderOperation"("id", "tenantId"),
  ADD CONSTRAINT "ProductionReport_run_tenant_fkey" FOREIGN KEY ("productionRunId", "tenantId") REFERENCES "ProductionRun"("id", "tenantId");

ALTER TABLE "ReworkRequirement"
  ADD COLUMN "processedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN "reworkOperationId" TEXT,
  ADD COLUMN "reworkRunId" TEXT,
  ADD CONSTRAINT "ReworkRequirement_reworkOperationId_fkey" FOREIGN KEY ("reworkOperationId") REFERENCES "WorkOrderOperation"("id"),
  ADD CONSTRAINT "ReworkRequirement_reworkRunId_fkey" FOREIGN KEY ("reworkRunId") REFERENCES "ProductionRun"("id");
ALTER TABLE "ReworkRequirement"
  ADD CONSTRAINT "ReworkRequirement_workOrder_tenant_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId"),
  ADD CONSTRAINT "ReworkRequirement_operation_tenant_fkey" FOREIGN KEY ("operationId", "tenantId") REFERENCES "WorkOrderOperation"("id", "tenantId"),
  ADD CONSTRAINT "ReworkRequirement_reworkOperation_tenant_fkey" FOREIGN KEY ("reworkOperationId", "tenantId") REFERENCES "WorkOrderOperation"("id", "tenantId"),
  ADD CONSTRAINT "ReworkRequirement_reworkRun_tenant_fkey" FOREIGN KEY ("reworkRunId", "tenantId") REFERENCES "ProductionRun"("id", "tenantId");

-- Existing installations retain the principle of least privilege: operators
-- receive normal execution actions; supervisory roles receive hold/rework.
INSERT INTO "ActionPermissionGrant" ("id", "tenantId", "action", "role", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."id", a.action, a.role::"Role", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (VALUES
  ('HMI_SETUP','ADMIN'),('HMI_SETUP','PLANNER'),('HMI_SETUP','FOREMAN'),('HMI_SETUP','OPERATOR'),
  ('HMI_PAUSE','ADMIN'),('HMI_PAUSE','PLANNER'),('HMI_PAUSE','FOREMAN'),('HMI_PAUSE','OPERATOR'),
  ('HMI_RESUME','ADMIN'),('HMI_RESUME','PLANNER'),('HMI_RESUME','FOREMAN'),('HMI_RESUME','OPERATOR'),
  ('HMI_REPORT','ADMIN'),('HMI_REPORT','PLANNER'),('HMI_REPORT','FOREMAN'),('HMI_REPORT','OPERATOR'),
  ('HMI_HOLD','ADMIN'),('HMI_HOLD','PLANNER'),('HMI_HOLD','FOREMAN'),
  ('HMI_HOLD_RELEASE','ADMIN'),('HMI_HOLD_RELEASE','PLANNER'),('HMI_HOLD_RELEASE','FOREMAN'),
  ('HMI_REWORK','ADMIN'),('HMI_REWORK','PLANNER'),('HMI_REWORK','FOREMAN')
) AS a(action, role)
WHERE NOT EXISTS (SELECT 1 FROM "ActionPermissionGrant" g WHERE g."tenantId" = t."id" AND g."action" = a.action AND g."role" = a.role::"Role");
