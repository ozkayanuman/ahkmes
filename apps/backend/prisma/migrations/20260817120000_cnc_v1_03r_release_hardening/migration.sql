-- CNC-V1-03R release hardening remains expand-only. The original daily-MRP
-- migration is immutable; this migration adds durable conversion linkage and
-- stored daily projected-balance evidence.

ALTER TABLE "WorkOrder" ADD COLUMN "mrpProposalId" TEXT;

CREATE TABLE "MrpBucket" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "itemType" "StockItemType" NOT NULL,
  "itemId" TEXT NOT NULL,
  "bucketDate" DATE NOT NULL,
  "openingAvailable" DECIMAL(18,6) NOT NULL,
  "scheduledReceipts" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "firmPlannedSupply" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "reservationCoverage" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "grossRequirements" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "safetyStock" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "proposedSupply" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "projectedAvailable" DECIMAL(18,6) NOT NULL,
  "projectedAboveSafety" DECIMAL(18,6) NOT NULL,
  "explanation" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MrpBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkOrder_mrpProposalId_key" ON "WorkOrder"("mrpProposalId");
CREATE UNIQUE INDEX "MrpBucket_runId_itemType_itemId_bucketDate_key" ON "MrpBucket"("runId", "itemType", "itemId", "bucketDate");
CREATE INDEX "MrpBucket_tenantId_plantId_itemType_itemId_bucketDate_idx" ON "MrpBucket"("tenantId", "plantId", "itemType", "itemId", "bucketDate");

ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_mrpProposalId_fkey" FOREIGN KEY ("mrpProposalId") REFERENCES "MrpProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_mrpProposalId_fkey" FOREIGN KEY ("mrpProposalId") REFERENCES "MrpProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpBucket" ADD CONSTRAINT "MrpBucket_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MrpRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
