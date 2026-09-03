-- CNC-V1-03R is an expand-only migration. Historical warehouses and purchase
-- orders intentionally remain plant-unassigned; MRP never nets them into a
-- plant run until an administrator provides explicit provenance.

CREATE TYPE "MrpRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "MrpPlanningPolicy" AS ENUM ('MAKE', 'BUY', 'MAKE_OR_BUY');
CREATE TYPE "MrpLotSizingRule" AS ENUM ('LOT_FOR_LOT', 'MINIMUM_QUANTITY', 'ORDER_MULTIPLE', 'FIXED_LOT_SIZE');
CREATE TYPE "MrpProposalStatus" AS ENUM ('PROPOSED', 'FIRMED', 'CONVERTED', 'CANCELLED', 'SUPERSEDED');
CREATE TYPE "MrpExceptionType" AS ENUM ('SHORTAGE', 'RESCHEDULE_IN', 'RESCHEDULE_OUT', 'CANCEL', 'QUANTITY_EXCESS', 'QUANTITY_SHORTAGE', 'MISSING_POLICY');
CREATE TYPE "MrpExceptionSeverity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');
CREATE TYPE "MrpDemandSourceType" AS ENUM ('SALES_ORDER_LINE', 'INDEPENDENT_DEMAND', 'WORK_ORDER', 'DEPENDENT_BOM', 'SAFETY_STOCK');
CREATE TYPE "PurchaseRequisitionStatus" AS ENUM ('DRAFT', 'OPEN', 'CANCELLED', 'CONVERTED');

ALTER TABLE "Warehouse" ADD COLUMN "plantId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "plantId" TEXT;

CREATE TABLE "MrpRun" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "planningDate" DATE NOT NULL,
  "horizonEnd" DATE NOT NULL,
  "status" "MrpRunStatus" NOT NULL DEFAULT 'RUNNING',
  "initiatedById" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "parameters" JSONB,
  "summary" JSONB,
  "failure" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MrpRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MrpPlanningParameter" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "itemType" "StockItemType" NOT NULL,
  "itemId" TEXT NOT NULL,
  "planningEnabled" BOOLEAN NOT NULL DEFAULT true,
  "policy" "MrpPlanningPolicy" NOT NULL,
  "leadTimeWorkingDays" INTEGER NOT NULL DEFAULT 0,
  "lotSizingRule" "MrpLotSizingRule" NOT NULL DEFAULT 'LOT_FOR_LOT',
  "minimumQuantity" DECIMAL(18,6),
  "maximumQuantity" DECIMAL(18,6),
  "orderMultiple" DECIMAL(18,6),
  "fixedLotSize" DECIMAL(18,6),
  "safetyStock" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "planningHorizonDays" INTEGER,
  "rescheduleToleranceDays" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MrpPlanningParameter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MrpIndependentDemand" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "itemType" "StockItemType" NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "requiredDate" DATE NOT NULL,
  "reference" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MrpIndependentDemand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MrpProposal" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "proposalNo" TEXT NOT NULL,
  "itemType" "StockItemType" NOT NULL,
  "itemId" TEXT NOT NULL,
  "policy" "MrpPlanningPolicy" NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "receiptDate" DATE NOT NULL,
  "releaseDate" DATE NOT NULL,
  "status" "MrpProposalStatus" NOT NULL DEFAULT 'PROPOSED',
  "sourceDemandType" "MrpDemandSourceType" NOT NULL,
  "sourceDemandId" TEXT NOT NULL,
  "calculation" JSONB NOT NULL,
  "parameterSnapshot" JSONB NOT NULL,
  "firmedAt" TIMESTAMP(3),
  "firmedById" TEXT,
  "convertedAt" TIMESTAMP(3),
  "convertedToType" TEXT,
  "convertedToId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MrpProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MrpPegging" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "demandType" "MrpDemandSourceType" NOT NULL,
  "demandId" TEXT NOT NULL,
  "parentDemandType" "MrpDemandSourceType",
  "parentDemandId" TEXT,
  "quantity" DECIMAL(18,6) NOT NULL,
  "requiredDate" DATE NOT NULL,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MrpPegging_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MrpException" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "proposalId" TEXT,
  "itemType" "StockItemType" NOT NULL,
  "itemId" TEXT NOT NULL,
  "type" "MrpExceptionType" NOT NULL,
  "severity" "MrpExceptionSeverity" NOT NULL,
  "quantity" DECIMAL(18,6),
  "requiredDate" DATE,
  "suggestedDate" DATE,
  "sourceDemandType" "MrpDemandSourceType",
  "sourceDemandId" TEXT,
  "supplyType" TEXT,
  "supplyId" TEXT,
  "projectedBalance" DECIMAL(18,6),
  "explanation" JSONB NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MrpException_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseRequisition" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "prqNo" TEXT NOT NULL,
  "status" "PurchaseRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
  "mrpProposalId" TEXT NOT NULL,
  "requiredDate" DATE NOT NULL,
  "requestedById" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseRequisition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseRequisitionLine" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "purchaseRequisitionId" TEXT NOT NULL,
  "itemType" "StockItemType" NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "neededByDate" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseRequisitionLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MrpPlanningParameter_tenantId_plantId_itemType_itemId_key" ON "MrpPlanningParameter"("tenantId", "plantId", "itemType", "itemId");
CREATE UNIQUE INDEX "MrpProposal_proposalNo_key" ON "MrpProposal"("proposalNo");
CREATE UNIQUE INDEX "PurchaseRequisition_prqNo_key" ON "PurchaseRequisition"("prqNo");
CREATE UNIQUE INDEX "PurchaseRequisition_mrpProposalId_key" ON "PurchaseRequisition"("mrpProposalId");
CREATE INDEX "Warehouse_tenantId_plantId_idx" ON "Warehouse"("tenantId", "plantId");
CREATE INDEX "PurchaseOrder_tenantId_plantId_status_idx" ON "PurchaseOrder"("tenantId", "plantId", "status");
CREATE INDEX "MrpRun_tenantId_plantId_planningDate_status_idx" ON "MrpRun"("tenantId", "plantId", "planningDate", "status");
CREATE INDEX "MrpPlanningParameter_tenantId_plantId_planningEnabled_idx" ON "MrpPlanningParameter"("tenantId", "plantId", "planningEnabled");
CREATE INDEX "MrpIndependentDemand_tenantId_plantId_requiredDate_isActive_idx" ON "MrpIndependentDemand"("tenantId", "plantId", "requiredDate", "isActive");
CREATE INDEX "MrpProposal_tenantId_plantId_status_receiptDate_idx" ON "MrpProposal"("tenantId", "plantId", "status", "receiptDate");
CREATE INDEX "MrpProposal_tenantId_plantId_itemType_itemId_status_idx" ON "MrpProposal"("tenantId", "plantId", "itemType", "itemId", "status");
CREATE INDEX "MrpPegging_tenantId_proposalId_idx" ON "MrpPegging"("tenantId", "proposalId");
CREATE INDEX "MrpPegging_tenantId_demandType_demandId_idx" ON "MrpPegging"("tenantId", "demandType", "demandId");
CREATE INDEX "MrpException_tenantId_plantId_severity_requiredDate_idx" ON "MrpException"("tenantId", "plantId", "severity", "requiredDate");
CREATE INDEX "MrpException_tenantId_runId_type_idx" ON "MrpException"("tenantId", "runId", "type");
CREATE INDEX "PurchaseRequisition_tenantId_plantId_status_requiredDate_idx" ON "PurchaseRequisition"("tenantId", "plantId", "status", "requiredDate");
CREATE INDEX "PurchaseRequisitionLine_tenantId_purchaseRequisitionId_idx" ON "PurchaseRequisitionLine"("tenantId", "purchaseRequisitionId");

ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpRun" ADD CONSTRAINT "MrpRun_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpProposal" ADD CONSTRAINT "MrpProposal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MrpRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpPegging" ADD CONSTRAINT "MrpPegging_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "MrpProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MrpException" ADD CONSTRAINT "MrpException_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MrpRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_purchaseRequisitionId_fkey" FOREIGN KEY ("purchaseRequisitionId") REFERENCES "PurchaseRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

WITH actions(action, role) AS (
  VALUES
    ('MRP_READ','ADMIN'),('MRP_READ','PLANNER'),('MRP_RUN','ADMIN'),('MRP_RUN','PLANNER'),
    ('MRP_FIRM','ADMIN'),('MRP_FIRM','PLANNER'),('MRP_CONVERT_MAKE','ADMIN'),('MRP_CONVERT_MAKE','PLANNER'),
    ('MRP_CONVERT_BUY','ADMIN'),('MRP_CONVERT_BUY','PLANNER'),('MRP_ADMIN_PARAMETERS','ADMIN'),('MRP_ADMIN_PARAMETERS','PLANNER')
)
INSERT INTO "ActionPermissionGrant" ("id", "tenantId", "action", "role", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."id", a.action, a.role::"Role", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t CROSS JOIN actions a
WHERE NOT EXISTS (SELECT 1 FROM "ActionPermissionGrant" g WHERE g."tenantId" = t."id" AND g."action" = a.action AND g."role" = a.role::"Role");
