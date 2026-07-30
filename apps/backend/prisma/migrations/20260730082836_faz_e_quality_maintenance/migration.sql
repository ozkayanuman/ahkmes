-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "CapaStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MaintenanceOrderType" AS ENUM ('PREVENTIVE', 'CORRECTIVE');

-- CreateEnum
CREATE TYPE "MaintenanceOrderStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "insNo" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "productionRunId" TEXT,
    "checkpointName" TEXT NOT NULL,
    "result" "InspectionResult" NOT NULL,
    "notes" TEXT,
    "nonConformanceId" TEXT,
    "inspectedById" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capa" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dofNo" TEXT NOT NULL,
    "sourceNonConformanceId" TEXT,
    "title" TEXT NOT NULL,
    "rootCause" TEXT,
    "actionPlan" TEXT,
    "status" "CapaStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calibration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kalNo" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "calibratedAt" TIMESTAMP(3) NOT NULL,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "performedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Calibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bakNo" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "type" "MaintenanceOrderType" NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "status" "MaintenanceOrderStatus" NOT NULL DEFAULT 'PLANNED',
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_insNo_key" ON "Inspection"("insNo");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_nonConformanceId_key" ON "Inspection"("nonConformanceId");

-- CreateIndex
CREATE INDEX "Inspection_tenantId_workOrderId_idx" ON "Inspection"("tenantId", "workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Capa_dofNo_key" ON "Capa"("dofNo");

-- CreateIndex
CREATE INDEX "Capa_tenantId_status_idx" ON "Capa"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Calibration_kalNo_key" ON "Calibration"("kalNo");

-- CreateIndex
CREATE INDEX "Calibration_tenantId_machineId_idx" ON "Calibration"("tenantId", "machineId");

-- CreateIndex
CREATE INDEX "Calibration_tenantId_nextDueDate_idx" ON "Calibration"("tenantId", "nextDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceOrder_bakNo_key" ON "MaintenanceOrder"("bakNo");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_tenantId_machineId_idx" ON "MaintenanceOrder"("tenantId", "machineId");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_tenantId_status_idx" ON "MaintenanceOrder"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_productionRunId_fkey" FOREIGN KEY ("productionRunId") REFERENCES "ProductionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "NonConformance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capa" ADD CONSTRAINT "Capa_sourceNonConformanceId_fkey" FOREIGN KEY ("sourceNonConformanceId") REFERENCES "NonConformance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capa" ADD CONSTRAINT "Capa_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calibration" ADD CONSTRAINT "Calibration_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calibration" ADD CONSTRAINT "Calibration_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
