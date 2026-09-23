CREATE TYPE "CustomerReturnStatus" AS ENUM ('AUTHORIZED', 'RECEIVED', 'CANCELLED');
ALTER TYPE "InventoryMovementType" ADD VALUE 'CUSTOMER_RETURN';

CREATE TABLE "CustomerReturn" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "rmaNo" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL, "status" "CustomerReturnStatus" NOT NULL DEFAULT 'AUTHORIZED',
  "reason" TEXT NOT NULL, "authorizedById" TEXT NOT NULL,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedById" TEXT, "receivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerReturn_rmaNo_key" UNIQUE ("rmaNo"),
  CONSTRAINT "CustomerReturn_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "CustomerReturnLine" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "customerReturnId" TEXT NOT NULL,
  "deliveryLineId" TEXT NOT NULL, "qty" DECIMAL(18,3) NOT NULL,
  CONSTRAINT "CustomerReturnLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerReturnLine_customerReturnId_deliveryLineId_key" UNIQUE ("customerReturnId", "deliveryLineId"),
  CONSTRAINT "CustomerReturnLine_customerReturnId_fkey" FOREIGN KEY ("customerReturnId") REFERENCES "CustomerReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerReturnLine_deliveryLineId_fkey" FOREIGN KEY ("deliveryLineId") REFERENCES "DeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CustomerReturn_tenantId_deliveryId_idx" ON "CustomerReturn"("tenantId", "deliveryId");
CREATE INDEX "CustomerReturn_tenantId_status_idx" ON "CustomerReturn"("tenantId", "status");
CREATE INDEX "CustomerReturnLine_tenantId_deliveryLineId_idx" ON "CustomerReturnLine"("tenantId", "deliveryLineId");
