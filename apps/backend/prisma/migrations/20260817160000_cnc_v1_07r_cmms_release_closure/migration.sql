-- CNC-V1-07R: extend the canonical Machine, MaintenanceOrder and DowntimeEvent
-- boundaries. No parallel asset, stock or production lifecycle is introduced.

CREATE TYPE "MachineMaintenanceState" AS ENUM ('AVAILABLE', 'MAINTENANCE_DUE', 'PLANNED_MAINTENANCE', 'BREAKDOWN', 'OUT_OF_SERVICE');
CREATE TYPE "MaintenanceCriticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "DowntimeOwnership" AS ENUM ('MES', 'MAINTENANCE');
CREATE TYPE "MaintenanceDowntimeCategory" AS ENUM ('PLANNED_MAINTENANCE', 'UNPLANNED_BREAKDOWN', 'OTHER_MAINTENANCE');
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "MaintenanceRequestStatus" AS ENUM ('OPEN', 'CONVERTED', 'CANCELLED');
CREATE TYPE "MaintenanceBreakdownStatus" AS ENUM ('OPEN', 'UNDER_REPAIR', 'RESOLVED', 'CANCELLED');
CREATE TYPE "MaintenanceCodeKind" AS ENUM ('FAILURE', 'CAUSE', 'REMEDY');
CREATE TYPE "MaintenanceMachineDisposition" AS ENUM ('KEEP_OUT_OF_SERVICE', 'READY_FOR_RETURN_TO_SERVICE', 'REPAIRED');
CREATE TYPE "MaintenanceSpareTransactionType" AS ENUM ('ISSUE', 'RETURN');

-- New values for DowntimeEventSource, InventoryMovementType and MaintenanceOrderStatus
-- are added in the prior migration 20260817150000_cnc_v1_07r_enum_values so they are
-- already committed and safe to use below (PostgreSQL error 55P04 otherwise).

ALTER TABLE "Machine"
  ADD COLUMN "plantId" TEXT,
  ADD COLUMN "assetCode" TEXT,
  ADD COLUMN "assetType" TEXT NOT NULL DEFAULT 'CNC_MACHINE',
  ADD COLUMN "manufacturer" TEXT,
  ADD COLUMN "serialNumber" TEXT,
  ADD COLUMN "commissionedAt" TIMESTAMP(3),
  ADD COLUMN "criticality" "MaintenanceCriticality" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "maintenanceState" "MachineMaintenanceState" NOT NULL DEFAULT 'AVAILABLE';

ALTER TABLE "DowntimeEvent"
  ADD COLUMN "ownership" "DowntimeOwnership" NOT NULL DEFAULT 'MES',
  ADD COLUMN "maintenanceCategory" "MaintenanceDowntimeCategory",
  ADD COLUMN "maintenanceBreakdownId" TEXT,
  ADD COLUMN "maintenanceOrderId" TEXT;

ALTER TABLE "MaintenanceOrder"
  ADD COLUMN "plantId" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "maintenancePlanId" TEXT,
  ADD COLUMN "breakdownId" TEXT,
  ADD COLUMN "occurrenceDueAt" TIMESTAMP(3),
  ADD COLUMN "priority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "description" TEXT,
  ADD COLUMN "plannedStart" TIMESTAMP(3),
  ADD COLUMN "plannedFinish" TIMESTAMP(3),
  ADD COLUMN "blockingFrom" TIMESTAMP(3),
  ADD COLUMN "blockingUntil" TIMESTAMP(3),
  ADD COLUMN "actualStart" TIMESTAMP(3),
  ADD COLUMN "actualFinish" TIMESTAMP(3),
  ADD COLUMN "completionNotes" TEXT,
  ADD COLUMN "resolution" TEXT,
  ADD COLUMN "failureCodeId" TEXT,
  ADD COLUMN "causeCodeId" TEXT,
  ADD COLUMN "remedyCodeId" TEXT,
  ADD COLUMN "remedy" TEXT,
  ADD COLUMN "machineDisposition" "MaintenanceMachineDisposition",
  ADD COLUMN "idempotencyKey" TEXT,
  ALTER COLUMN "scheduledDate" DROP NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE TABLE "MaintenanceRequest" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "problem" TEXT NOT NULL,
  "priority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIUM',
  "description" TEXT,
  "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reportedById" TEXT NOT NULL,
  "productionWorkOrderId" TEXT,
  "documentId" TEXT,
  "status" "MaintenanceRequestStatus" NOT NULL DEFAULT 'OPEN',
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "MaintenanceBreakdown" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "requestId" TEXT,
  "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failureStartedAt" TIMESTAMP(3) NOT NULL,
  "detectedById" TEXT NOT NULL,
  "failureCodeId" TEXT,
  "description" TEXT NOT NULL,
  "priority" "MaintenancePriority" NOT NULL DEFAULT 'HIGH',
  "productionImpact" TEXT NOT NULL DEFAULT 'PRODUCTION_STOPPED',
  "status" "MaintenanceBreakdownStatus" NOT NULL DEFAULT 'OPEN',
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "MaintenanceCode" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "kind" "MaintenanceCodeKind" NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "MaintenancePlan" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "MaintenanceOrderType" NOT NULL DEFAULT 'PREVENTIVE',
  "frequencyDays" INTEGER NOT NULL,
  "effectiveStart" TIMESTAMP(3) NOT NULL,
  "nextDueAt" TIMESTAMP(3) NOT NULL,
  "warningDays" INTEGER NOT NULL DEFAULT 7,
  "defaultPriority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIUM',
  "defaultDescription" TEXT,
  "defaultTasks" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "MaintenanceTechnicianAssignment" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "maintenanceOrderId" TEXT NOT NULL,
  "technicianId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedById" TEXT NOT NULL
);

CREATE TABLE "MaintenanceTask" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "maintenanceOrderId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "completedById" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MaintenanceLaborEntry" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "maintenanceOrderId" TEXT NOT NULL,
  "technicianId" TEXT NOT NULL,
  "workDate" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "durationMinutes" INTEGER NOT NULL,
  "category" TEXT,
  "notes" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MaintenanceSpareLine" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "maintenanceOrderId" TEXT NOT NULL,
  "itemType" "StockItemType" NOT NULL,
  "itemId" TEXT NOT NULL,
  "plannedQuantity" DECIMAL(18,6) NOT NULL,
  "issuedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "returnedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "MaintenanceSpareTransaction" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "spareLineId" TEXT NOT NULL,
  "type" "MaintenanceSpareTransactionType" NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "binId" TEXT NOT NULL,
  "lotId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MachineMaintenanceStateEvent" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "fromState" "MachineMaintenanceState" NOT NULL,
  "toState" "MachineMaintenanceState" NOT NULL,
  "reason" TEXT NOT NULL,
  "maintenanceOrderId" TEXT,
  "breakdownId" TEXT,
  "actorId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ReturnToServiceEvent" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "maintenanceOrderId" TEXT,
  "breakdownId" TEXT,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "Machine_tenantId_assetCode_key" ON "Machine"("tenantId", "assetCode");
CREATE INDEX "Machine_tenantId_plantId_maintenanceState_idx" ON "Machine"("tenantId", "plantId", "maintenanceState");
CREATE INDEX "DowntimeEvent_tenantId_ownership_startedAt_idx" ON "DowntimeEvent"("tenantId", "ownership", "startedAt");
CREATE UNIQUE INDEX "DowntimeEvent_one_open_maintenance_per_machine" ON "DowntimeEvent"("tenantId", "machineId") WHERE "ownership" = 'MAINTENANCE' AND "endedAt" IS NULL;
CREATE UNIQUE INDEX "MaintenanceOrder_id_tenantId_key" ON "MaintenanceOrder"("id", "tenantId");
CREATE UNIQUE INDEX "MaintenanceOrder_tenantId_idempotencyKey_key" ON "MaintenanceOrder"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "MaintenanceOrder_breakdownId_tenantId_key" ON "MaintenanceOrder"("breakdownId", "tenantId");
CREATE UNIQUE INDEX "MaintenanceOrder_maintenancePlanId_occurrenceDueAt_key" ON "MaintenanceOrder"("maintenancePlanId", "occurrenceDueAt");
CREATE INDEX "MaintenanceOrder_tenantId_plantId_status_idx" ON "MaintenanceOrder"("tenantId", "plantId", "status");
CREATE INDEX "MaintenanceOrder_tenantId_machineId_status_idx" ON "MaintenanceOrder"("tenantId", "machineId", "status");
CREATE INDEX "MaintenanceOrder_tenantId_scheduledDate_idx" ON "MaintenanceOrder"("tenantId", "scheduledDate");
CREATE UNIQUE INDEX "MaintenanceRequest_id_tenantId_key" ON "MaintenanceRequest"("id", "tenantId");
CREATE UNIQUE INDEX "MaintenanceRequest_tenantId_idempotencyKey_key" ON "MaintenanceRequest"("tenantId", "idempotencyKey");
CREATE INDEX "MaintenanceRequest_tenantId_plantId_status_reportedAt_idx" ON "MaintenanceRequest"("tenantId", "plantId", "status", "reportedAt");
CREATE INDEX "MaintenanceRequest_tenantId_machineId_reportedAt_idx" ON "MaintenanceRequest"("tenantId", "machineId", "reportedAt");
CREATE UNIQUE INDEX "MaintenanceBreakdown_id_tenantId_key" ON "MaintenanceBreakdown"("id", "tenantId");
CREATE UNIQUE INDEX "MaintenanceBreakdown_tenantId_idempotencyKey_key" ON "MaintenanceBreakdown"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "MaintenanceBreakdown_requestId_tenantId_key" ON "MaintenanceBreakdown"("requestId", "tenantId");
CREATE UNIQUE INDEX "MaintenanceBreakdown_one_open_per_machine" ON "MaintenanceBreakdown"("tenantId", "machineId") WHERE "status" IN ('OPEN', 'UNDER_REPAIR');
CREATE INDEX "MaintenanceBreakdown_tenantId_plantId_status_failureStartedAt_idx" ON "MaintenanceBreakdown"("tenantId", "plantId", "status", "failureStartedAt");
CREATE UNIQUE INDEX "MaintenanceCode_id_tenantId_key" ON "MaintenanceCode"("id", "tenantId");
CREATE UNIQUE INDEX "MaintenanceCode_tenantId_kind_code_key" ON "MaintenanceCode"("tenantId", "kind", "code");
CREATE UNIQUE INDEX "MaintenancePlan_id_tenantId_key" ON "MaintenancePlan"("id", "tenantId");
CREATE UNIQUE INDEX "MaintenancePlan_tenantId_machineId_name_key" ON "MaintenancePlan"("tenantId", "machineId", "name");
CREATE INDEX "MaintenancePlan_tenantId_plantId_active_nextDueAt_idx" ON "MaintenancePlan"("tenantId", "plantId", "active", "nextDueAt");
CREATE UNIQUE INDEX "MaintenanceTechnicianAssignment_tenantId_maintenanceOrderId_technicianId_key" ON "MaintenanceTechnicianAssignment"("tenantId", "maintenanceOrderId", "technicianId");
CREATE UNIQUE INDEX "MaintenanceTechnicianAssignment_one_primary" ON "MaintenanceTechnicianAssignment"("tenantId", "maintenanceOrderId") WHERE "isPrimary";
CREATE UNIQUE INDEX "MaintenanceTask_tenantId_maintenanceOrderId_sequence_key" ON "MaintenanceTask"("tenantId", "maintenanceOrderId", "sequence");
CREATE UNIQUE INDEX "MaintenanceLaborEntry_tenantId_idempotencyKey_key" ON "MaintenanceLaborEntry"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "MaintenanceSpareLine_id_tenantId_key" ON "MaintenanceSpareLine"("id", "tenantId");
CREATE UNIQUE INDEX "MaintenanceSpareTransaction_tenantId_idempotencyKey_key" ON "MaintenanceSpareTransaction"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "ReturnToServiceEvent_tenantId_idempotencyKey_key" ON "ReturnToServiceEvent"("tenantId", "idempotencyKey");

ALTER TABLE "DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_valid_interval" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_valid_planned_interval" CHECK ("plannedFinish" IS NULL OR "plannedStart" IS NULL OR "plannedFinish" >= "plannedStart");
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_valid_blocking_interval" CHECK ("blockingUntil" IS NULL OR "blockingFrom" IS NULL OR "blockingUntil" >= "blockingFrom");
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_valid_actual_interval" CHECK ("actualFinish" IS NULL OR "actualStart" IS NULL OR "actualFinish" >= "actualStart");
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_positive_frequency" CHECK ("frequencyDays" > 0 AND "warningDays" >= 0);
ALTER TABLE "MaintenanceLaborEntry" ADD CONSTRAINT "MaintenanceLaborEntry_positive_duration" CHECK ("durationMinutes" > 0);
ALTER TABLE "MaintenanceLaborEntry" ADD CONSTRAINT "MaintenanceLaborEntry_valid_interval" CHECK ("endedAt" IS NULL OR "startedAt" IS NULL OR "endedAt" >= "startedAt");
ALTER TABLE "MaintenanceSpareLine" ADD CONSTRAINT "MaintenanceSpareLine_valid_quantities" CHECK ("plannedQuantity" > 0 AND "issuedQty" >= 0 AND "returnedQty" >= 0 AND "returnedQty" <= "issuedQty");
ALTER TABLE "MaintenanceSpareTransaction" ADD CONSTRAINT "MaintenanceSpareTransaction_positive_quantity" CHECK ("quantity" > 0);

ALTER TABLE "MaintenanceOrder" DROP CONSTRAINT IF EXISTS "MaintenanceOrder_machineId_fkey";
ALTER TABLE "MaintenanceOrder" DROP CONSTRAINT IF EXISTS "MaintenanceOrder_createdById_fkey";
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_plantId_tenantId_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_plantId_tenantId_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_machineId_tenantId_fkey" FOREIGN KEY ("machineId", "tenantId") REFERENCES "Machine"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_plantId_tenantId_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_machineId_tenantId_fkey" FOREIGN KEY ("machineId", "tenantId") REFERENCES "Machine"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_reportedById_tenantId_fkey" FOREIGN KEY ("reportedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceBreakdown" ADD CONSTRAINT "MaintenanceBreakdown_plantId_tenantId_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceBreakdown" ADD CONSTRAINT "MaintenanceBreakdown_machineId_tenantId_fkey" FOREIGN KEY ("machineId", "tenantId") REFERENCES "Machine"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceBreakdown" ADD CONSTRAINT "MaintenanceBreakdown_detectedById_tenantId_fkey" FOREIGN KEY ("detectedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceCode" ADD CONSTRAINT "MaintenanceCode_tenant_guard" CHECK (length("tenantId") > 0);
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_plantId_tenantId_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_machineId_tenantId_fkey" FOREIGN KEY ("machineId", "tenantId") REFERENCES "Machine"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_requestId_tenantId_fkey" FOREIGN KEY ("requestId", "tenantId") REFERENCES "MaintenanceRequest"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_maintenancePlanId_tenantId_fkey" FOREIGN KEY ("maintenancePlanId", "tenantId") REFERENCES "MaintenancePlan"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_breakdownId_tenantId_fkey" FOREIGN KEY ("breakdownId", "tenantId") REFERENCES "MaintenanceBreakdown"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_failureCodeId_tenantId_fkey" FOREIGN KEY ("failureCodeId", "tenantId") REFERENCES "MaintenanceCode"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_causeCodeId_tenantId_fkey" FOREIGN KEY ("causeCodeId", "tenantId") REFERENCES "MaintenanceCode"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_remedyCodeId_tenantId_fkey" FOREIGN KEY ("remedyCodeId", "tenantId") REFERENCES "MaintenanceCode"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceBreakdown" ADD CONSTRAINT "MaintenanceBreakdown_requestId_tenantId_fkey" FOREIGN KEY ("requestId", "tenantId") REFERENCES "MaintenanceRequest"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceBreakdown" ADD CONSTRAINT "MaintenanceBreakdown_failureCodeId_tenantId_fkey" FOREIGN KEY ("failureCodeId", "tenantId") REFERENCES "MaintenanceCode"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_maintenanceBreakdownId_tenantId_fkey" FOREIGN KEY ("maintenanceBreakdownId", "tenantId") REFERENCES "MaintenanceBreakdown"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_maintenanceOrderId_tenantId_fkey" FOREIGN KEY ("maintenanceOrderId", "tenantId") REFERENCES "MaintenanceOrder"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTechnicianAssignment" ADD CONSTRAINT "MaintenanceTechnicianAssignment_order_fkey" FOREIGN KEY ("maintenanceOrderId", "tenantId") REFERENCES "MaintenanceOrder"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTechnicianAssignment" ADD CONSTRAINT "MaintenanceTechnicianAssignment_technician_fkey" FOREIGN KEY ("technicianId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_order_fkey" FOREIGN KEY ("maintenanceOrderId", "tenantId") REFERENCES "MaintenanceOrder"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_completedBy_fkey" FOREIGN KEY ("completedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceLaborEntry" ADD CONSTRAINT "MaintenanceLaborEntry_order_fkey" FOREIGN KEY ("maintenanceOrderId", "tenantId") REFERENCES "MaintenanceOrder"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceLaborEntry" ADD CONSTRAINT "MaintenanceLaborEntry_technician_fkey" FOREIGN KEY ("technicianId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceSpareLine" ADD CONSTRAINT "MaintenanceSpareLine_order_fkey" FOREIGN KEY ("maintenanceOrderId", "tenantId") REFERENCES "MaintenanceOrder"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceSpareTransaction" ADD CONSTRAINT "MaintenanceSpareTransaction_line_fkey" FOREIGN KEY ("spareLineId", "tenantId") REFERENCES "MaintenanceSpareLine"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceSpareTransaction" ADD CONSTRAINT "MaintenanceSpareTransaction_actor_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MachineMaintenanceStateEvent" ADD CONSTRAINT "MachineMaintenanceStateEvent_machine_fkey" FOREIGN KEY ("machineId", "tenantId") REFERENCES "Machine"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MachineMaintenanceStateEvent" ADD CONSTRAINT "MachineMaintenanceStateEvent_actor_fkey" FOREIGN KEY ("actorId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnToServiceEvent" ADD CONSTRAINT "ReturnToServiceEvent_machine_fkey" FOREIGN KEY ("machineId", "tenantId") REFERENCES "Machine"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnToServiceEvent" ADD CONSTRAINT "ReturnToServiceEvent_order_fkey" FOREIGN KEY ("maintenanceOrderId", "tenantId") REFERENCES "MaintenanceOrder"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnToServiceEvent" ADD CONSTRAINT "ReturnToServiceEvent_actor_fkey" FOREIGN KEY ("actorId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill supported CMMS actions without changing legacy entitlement authority.
INSERT INTO "ActionPermissionGrant" ("id", "tenantId", "action", "role", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."id", grants.action, grants.role::"Role", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (VALUES
 ('CMMS_READ','ADMIN'),('CMMS_READ','PLANNER'),('CMMS_READ','FOREMAN'),
 ('CMMS_REQUEST_CREATE','ADMIN'),('CMMS_REQUEST_CREATE','PLANNER'),('CMMS_REQUEST_CREATE','FOREMAN'),('CMMS_REQUEST_CREATE','OPERATOR'),
 ('CMMS_BREAKDOWN_DECLARE','ADMIN'),('CMMS_BREAKDOWN_DECLARE','PLANNER'),('CMMS_BREAKDOWN_DECLARE','FOREMAN'),('CMMS_BREAKDOWN_DECLARE','OPERATOR'),
 ('CMMS_WO_PLAN','ADMIN'),('CMMS_WO_PLAN','PLANNER'),('CMMS_WO_EXECUTE','ADMIN'),('CMMS_WO_EXECUTE','PLANNER'),('CMMS_WO_EXECUTE','FOREMAN'),
 ('CMMS_ASSIGN_TECHNICIAN','ADMIN'),('CMMS_ASSIGN_TECHNICIAN','PLANNER'),('CMMS_ASSIGN_TECHNICIAN','FOREMAN'),
 ('CMMS_SPARE_ISSUE','ADMIN'),('CMMS_SPARE_ISSUE','PLANNER'),('CMMS_SPARE_ISSUE','FOREMAN'),
 ('CMMS_PM_ADMIN','ADMIN'),('CMMS_PM_ADMIN','PLANNER'),('CMMS_RETURN_TO_SERVICE','ADMIN'),('CMMS_RETURN_TO_SERVICE','FOREMAN'),('CMMS_CODE_ADMIN','ADMIN')
) AS grants(action, role)
WHERE NOT EXISTS (
  SELECT 1 FROM "ActionPermissionGrant" existing
  WHERE existing."tenantId" = t."id" AND existing."action" = grants.action AND existing."role" = grants.role::"Role"
);
