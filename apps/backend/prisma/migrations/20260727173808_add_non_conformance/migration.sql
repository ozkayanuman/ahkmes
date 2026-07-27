-- CreateEnum
CREATE TYPE "NonConformanceStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "NonConformanceActionType" AS ENUM ('GENERIC', 'SCRAP', 'REWORK', 'BLOCKING');

-- CreateTable
CREATE TABLE "NonConformance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "productionRunId" TEXT,
    "reportedById" TEXT NOT NULL,
    "failureType" TEXT NOT NULL,
    "description" TEXT,
    "actionType" "NonConformanceActionType" NOT NULL DEFAULT 'GENERIC',
    "status" "NonConformanceStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NonConformance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NonConformance_tenantId_idx" ON "NonConformance"("tenantId");

-- CreateIndex
CREATE INDEX "NonConformance_workOrderId_idx" ON "NonConformance"("workOrderId");

-- AddForeignKey
ALTER TABLE "NonConformance" ADD CONSTRAINT "NonConformance_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonConformance" ADD CONSTRAINT "NonConformance_productionRunId_fkey" FOREIGN KEY ("productionRunId") REFERENCES "ProductionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonConformance" ADD CONSTRAINT "NonConformance_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
