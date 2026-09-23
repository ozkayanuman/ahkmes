-- CNC-V1-09R: immutable standard-rate evidence and work-order costing baselines.
-- Existing mutable Material/Machine/User rate fields stay untouched for legacy
-- reads; no historical work order is backfilled with an invented baseline.

CREATE TYPE "CostRateCardStatus" AS ENUM ('DRAFT', 'RELEASED', 'SUPERSEDED');
CREATE TYPE "CostRateKind" AS ENUM ('MATERIAL', 'MACHINE', 'LABOR');

CREATE TABLE "CostRateCard" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "status" "CostRateCardStatus" NOT NULL DEFAULT 'DRAFT',
  "releasedAt" TIMESTAMP(3),
  "releasedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostRateCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostRateLine" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "rateCardId" TEXT NOT NULL,
  "kind" "CostRateKind" NOT NULL,
  "targetId" TEXT NOT NULL,
  "rate" DECIMAL(18,6) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostRateLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkOrderCostBaseline" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "rateCardId" TEXT,
  "rateCardRevision" INTEGER,
  "currency" VARCHAR(3),
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "capturedById" TEXT NOT NULL,
  "plannedMaterialCost" DECIMAL(18,6),
  "plannedMachineCost" DECIMAL(18,6),
  "plannedLaborCost" DECIMAL(18,6),
  "plannedTotalCost" DECIMAL(18,6),
  "dataQuality" TEXT NOT NULL DEFAULT 'PARTIAL',
  "issues" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderCostBaseline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkOrderCostBaselineLine" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "baselineId" TEXT NOT NULL,
  "kind" "CostRateKind" NOT NULL,
  "targetId" TEXT,
  "operationId" TEXT,
  "quantity" DECIMAL(18,6),
  "minutes" DECIMAL(18,6),
  "rate" DECIMAL(18,6),
  "amount" DECIMAL(18,6),
  "issueCode" TEXT,
  "provenance" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderCostBaselineLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CostRateCard_id_tenantId_key" ON "CostRateCard"("id", "tenantId");
CREATE UNIQUE INDEX "CostRateCard_tenantId_plantId_revision_key" ON "CostRateCard"("tenantId", "plantId", "revision");
CREATE UNIQUE INDEX "CostRateCard_tenantId_plantId_effectiveFrom_key" ON "CostRateCard"("tenantId", "plantId", "effectiveFrom");
CREATE INDEX "CostRateCard_tenantId_plantId_status_effectiveFrom_idx" ON "CostRateCard"("tenantId", "plantId", "status", "effectiveFrom");
CREATE UNIQUE INDEX "CostRateLine_tenantId_rateCardId_kind_targetId_key" ON "CostRateLine"("tenantId", "rateCardId", "kind", "targetId");
CREATE INDEX "CostRateLine_tenantId_rateCardId_kind_idx" ON "CostRateLine"("tenantId", "rateCardId", "kind");
CREATE UNIQUE INDEX "WorkOrderCostBaseline_workOrderId_key" ON "WorkOrderCostBaseline"("workOrderId");
CREATE UNIQUE INDEX "WorkOrderCostBaseline_id_tenantId_key" ON "WorkOrderCostBaseline"("id", "tenantId");
CREATE UNIQUE INDEX "WorkOrderCostBaseline_workOrderId_tenantId_key" ON "WorkOrderCostBaseline"("workOrderId", "tenantId");
CREATE INDEX "WorkOrderCostBaseline_tenantId_rateCardId_idx" ON "WorkOrderCostBaseline"("tenantId", "rateCardId");
CREATE INDEX "WorkOrderCostBaselineLine_tenantId_baselineId_kind_idx" ON "WorkOrderCostBaselineLine"("tenantId", "baselineId", "kind");

ALTER TABLE "CostRateLine" ADD CONSTRAINT "CostRateLine_positive_rate" CHECK ("rate" >= 0);
ALTER TABLE "WorkOrderCostBaselineLine" ADD CONSTRAINT "WorkOrderCostBaselineLine_nonnegative_amount" CHECK ("amount" IS NULL OR "amount" >= 0);
ALTER TABLE "CostRateCard" ADD CONSTRAINT "CostRateCard_plantId_tenantId_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostRateLine" ADD CONSTRAINT "CostRateLine_rateCardId_tenantId_fkey" FOREIGN KEY ("rateCardId", "tenantId") REFERENCES "CostRateCard"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrderCostBaseline" ADD CONSTRAINT "WorkOrderCostBaseline_workOrderId_tenantId_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrderCostBaseline" ADD CONSTRAINT "WorkOrderCostBaseline_rateCardId_tenantId_fkey" FOREIGN KEY ("rateCardId", "tenantId") REFERENCES "CostRateCard"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrderCostBaselineLine" ADD CONSTRAINT "WorkOrderCostBaselineLine_baselineId_tenantId_fkey" FOREIGN KEY ("baselineId", "tenantId") REFERENCES "WorkOrderCostBaseline"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve legacy authority while granting the V1 costing workspace to the
-- same planning/admin roles that own released manufacturing engineering.
INSERT INTO "ActionPermissionGrant" ("id", "tenantId", "action", "role", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."id", grants.action, grants.role::"Role", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (VALUES
  ('COSTING_READ', 'ADMIN'), ('COSTING_READ', 'PLANNER'), ('COSTING_READ', 'FOREMAN'),
  ('COSTING_RATE_ADMIN', 'ADMIN'), ('COSTING_RATE_ADMIN', 'PLANNER')
) AS grants(action, role)
WHERE NOT EXISTS (
  SELECT 1 FROM "ActionPermissionGrant" existing
  WHERE existing."tenantId" = t."id" AND existing."action" = grants.action AND existing."role" = grants.role::"Role"
);
