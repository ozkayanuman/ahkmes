-- CreateEnum
CREATE TYPE "AlarmSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "FinishedGoodsEntry" ADD COLUMN     "lotId" TEXT;

-- AlterTable
ALTER TABLE "MachineStatusEvent" ADD COLUMN     "ackNote" TEXT,
ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedById" TEXT;

-- AlterTable
ALTER TABLE "MaterialConsumption" ADD COLUMN     "lotId" TEXT;

-- CreateTable
CREATE TABLE "AlarmDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "AlarmSeverity" NOT NULL DEFAULT 'MEDIUM',
    "machineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlarmDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeHeader" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "revision" TEXT NOT NULL DEFAULT 'A',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeHeader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipeHeaderId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "parameterName" TEXT,
    "parameterValue" TEXT,
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpcCharacteristic" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "target" DECIMAL(18,6),
    "uslUpper" DECIMAL(18,6),
    "lslLower" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpcCharacteristic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpcMeasurement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "characteristicId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "value" DECIMAL(18,6) NOT NULL,
    "inSpec" BOOLEAN,
    "measuredById" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpcMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlarmDefinition_tenantId_idx" ON "AlarmDefinition"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AlarmDefinition_tenantId_code_key" ON "AlarmDefinition"("tenantId", "code");

-- CreateIndex
CREATE INDEX "RecipeHeader_tenantId_partId_isActive_idx" ON "RecipeHeader"("tenantId", "partId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeHeader_tenantId_partId_revision_key" ON "RecipeHeader"("tenantId", "partId", "revision");

-- CreateIndex
CREATE INDEX "RecipeStep_tenantId_recipeHeaderId_idx" ON "RecipeStep"("tenantId", "recipeHeaderId");

-- CreateIndex
CREATE INDEX "SpcCharacteristic_tenantId_partId_idx" ON "SpcCharacteristic"("tenantId", "partId");

-- CreateIndex
CREATE UNIQUE INDEX "SpcCharacteristic_tenantId_partId_name_key" ON "SpcCharacteristic"("tenantId", "partId", "name");

-- CreateIndex
CREATE INDEX "SpcMeasurement_tenantId_characteristicId_measuredAt_idx" ON "SpcMeasurement"("tenantId", "characteristicId", "measuredAt");

-- AddForeignKey
ALTER TABLE "MachineStatusEvent" ADD CONSTRAINT "MachineStatusEvent_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlarmDefinition" ADD CONSTRAINT "AlarmDefinition_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialConsumption" ADD CONSTRAINT "MaterialConsumption_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodsEntry" ADD CONSTRAINT "FinishedGoodsEntry_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeHeader" ADD CONSTRAINT "RecipeHeader_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeStep" ADD CONSTRAINT "RecipeStep_recipeHeaderId_fkey" FOREIGN KEY ("recipeHeaderId") REFERENCES "RecipeHeader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpcCharacteristic" ADD CONSTRAINT "SpcCharacteristic_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpcMeasurement" ADD CONSTRAINT "SpcMeasurement_characteristicId_fkey" FOREIGN KEY ("characteristicId") REFERENCES "SpcCharacteristic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpcMeasurement" ADD CONSTRAINT "SpcMeasurement_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpcMeasurement" ADD CONSTRAINT "SpcMeasurement_measuredById_fkey" FOREIGN KEY ("measuredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
