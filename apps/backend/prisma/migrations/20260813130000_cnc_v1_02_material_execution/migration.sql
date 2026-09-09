-- CNC-V1-02: production demand/allocation/execution projections. InventoryMovement
-- remains the sole physical-stock ledger; these tables never hold on-hand stock.
CREATE TYPE "ProductionMaterialRequirementStatus" AS ENUM ('OPEN','PARTIALLY_ALLOCATED','ALLOCATED','PARTIALLY_ISSUED','ISSUED','CANCELLED','CLOSED');
CREATE TYPE "ProductionMaterialIssueMethod" AS ENUM ('MANUAL_ISSUE','BACKFLUSH');
CREATE TYPE "ProductionMaterialTransactionType" AS ENUM ('ISSUE','CONSUME','RETURN','SCRAP','BACKFLUSH');
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PRODUCTION_ISSUE';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PRODUCTION_RETURN';
ALTER TABLE "BomLine" ADD COLUMN "issueMethod" "ProductionMaterialIssueMethod" NOT NULL DEFAULT 'MANUAL_ISSUE';
ALTER TABLE "BomLine" ADD COLUMN "consumeOnScrap" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "ProductionMaterialRequirement" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "workOrderId" TEXT NOT NULL, "operationId" TEXT,
 "itemType" "StockItemType" NOT NULL, "itemId" TEXT NOT NULL, "unit" TEXT NOT NULL,
 "requiredQty" DECIMAL(18,6) NOT NULL, "issueMethod" "ProductionMaterialIssueMethod" NOT NULL DEFAULT 'MANUAL_ISSUE',
 "consumeOnScrap" BOOLEAN NOT NULL DEFAULT true, "status" "ProductionMaterialRequirementStatus" NOT NULL DEFAULT 'OPEN',
 "reservedQty" DECIMAL(18,6) NOT NULL DEFAULT 0, "issuedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
 "consumedQty" DECIMAL(18,6) NOT NULL DEFAULT 0, "returnedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
 "scrappedQty" DECIMAL(18,6) NOT NULL DEFAULT 0, "snapshotLine" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ProductionMaterialRequirement_pkey" PRIMARY KEY ("id"));
ALTER TABLE "ProductionMaterialRequirement" ADD CONSTRAINT "ProductionMaterialRequirement_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE;
ALTER TABLE "ProductionMaterialRequirement" ADD CONSTRAINT "ProductionMaterialRequirement_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL;
CREATE INDEX "ProductionMaterialRequirement_tenantId_workOrderId_operationId_idx" ON "ProductionMaterialRequirement"("tenantId","workOrderId","operationId");
CREATE INDEX "ProductionMaterialRequirement_tenantId_itemType_itemId_status_idx" ON "ProductionMaterialRequirement"("tenantId","itemType","itemId","status");

CREATE TABLE "ProductionMaterialReservation" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "requirementId" TEXT NOT NULL, "binId" TEXT NOT NULL, "lotId" TEXT,
 "quantity" DECIMAL(18,6) NOT NULL, "issuedQty" DECIMAL(18,6) NOT NULL DEFAULT 0, "idempotencyKey" TEXT NOT NULL, "status" "ProductionMaterialRequirementStatus" NOT NULL DEFAULT 'OPEN', "createdById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ProductionMaterialReservation_pkey" PRIMARY KEY ("id"));
ALTER TABLE "ProductionMaterialReservation" ADD CONSTRAINT "ProductionMaterialReservation_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ProductionMaterialRequirement"("id") ON DELETE CASCADE;
ALTER TABLE "ProductionMaterialReservation" ADD CONSTRAINT "ProductionMaterialReservation_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id");
ALTER TABLE "ProductionMaterialReservation" ADD CONSTRAINT "ProductionMaterialReservation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id");
ALTER TABLE "ProductionMaterialReservation" ADD CONSTRAINT "ProductionMaterialReservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id");
CREATE INDEX "ProductionMaterialReservation_tenantId_requirementId_status_idx" ON "ProductionMaterialReservation"("tenantId","requirementId","status");
CREATE INDEX "ProductionMaterialReservation_tenantId_binId_lotId_status_idx" ON "ProductionMaterialReservation"("tenantId","binId","lotId","status");
CREATE UNIQUE INDEX "ProductionMaterialReservation_tenantId_idempotencyKey_key" ON "ProductionMaterialReservation"("tenantId","idempotencyKey");

CREATE TABLE "ProductionMaterialTransaction" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "requirementId" TEXT NOT NULL, "reservationId" TEXT,
 "type" "ProductionMaterialTransactionType" NOT NULL, "quantity" DECIMAL(18,6) NOT NULL, "binId" TEXT, "lotId" TEXT,
 "reasonCode" TEXT, "idempotencyKey" TEXT NOT NULL, "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ProductionMaterialTransaction_pkey" PRIMARY KEY ("id"));
ALTER TABLE "ProductionMaterialTransaction" ADD CONSTRAINT "ProductionMaterialTransaction_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ProductionMaterialRequirement"("id") ON DELETE CASCADE;
ALTER TABLE "ProductionMaterialTransaction" ADD CONSTRAINT "ProductionMaterialTransaction_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "ProductionMaterialReservation"("id") ON DELETE SET NULL;
ALTER TABLE "ProductionMaterialTransaction" ADD CONSTRAINT "ProductionMaterialTransaction_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id");
ALTER TABLE "ProductionMaterialTransaction" ADD CONSTRAINT "ProductionMaterialTransaction_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id");
ALTER TABLE "ProductionMaterialTransaction" ADD CONSTRAINT "ProductionMaterialTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id");
CREATE UNIQUE INDEX "ProductionMaterialTransaction_tenantId_idempotencyKey_key" ON "ProductionMaterialTransaction"("tenantId","idempotencyKey");
CREATE INDEX "ProductionMaterialTransaction_tenantId_requirementId_createdAt_idx" ON "ProductionMaterialTransaction"("tenantId","requirementId","createdAt");
