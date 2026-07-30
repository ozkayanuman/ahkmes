-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "lastPmRuntimeHours" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pmIntervalHours" DECIMAL(18,2),
ADD COLUMN     "runtimeHours" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EnergyReading" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "kwh" DECIMAL(18,3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnergyReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnergyReading_tenantId_machineId_idx" ON "EnergyReading"("tenantId", "machineId");

-- CreateIndex
CREATE INDEX "EnergyReading_tenantId_recordedAt_idx" ON "EnergyReading"("tenantId", "recordedAt");

-- AddForeignKey
ALTER TABLE "EnergyReading" ADD CONSTRAINT "EnergyReading_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyReading" ADD CONSTRAINT "EnergyReading_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
