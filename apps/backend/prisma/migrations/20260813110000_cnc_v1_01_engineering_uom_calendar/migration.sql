-- CNC-V1-01: released engineering definitions, tenant UOM catalogue and
-- plant-local production calendars. This migration is additive; historical
-- work orders deliberately retain unknown engineering provenance.
CREATE TYPE "EngineeringStatus" AS ENUM ('DRAFT', 'RELEASED', 'OBSOLETE', 'LEGACY_UNVERIFIED');
CREATE TYPE "UomDimension" AS ENUM ('COUNT', 'MASS', 'LENGTH', 'AREA', 'VOLUME', 'TIME');
ALTER TYPE "WorkOrderStatus" ADD VALUE IF NOT EXISTS 'RELEASED';

ALTER TABLE "Plant" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul';
ALTER TABLE "Part" ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'EA';
ALTER TABLE "Part" ADD COLUMN "engineeringStatus" "EngineeringStatus" NOT NULL DEFAULT 'LEGACY_UNVERIFIED';
ALTER TABLE "BomHeader" ADD COLUMN "status" "EngineeringStatus" NOT NULL DEFAULT 'LEGACY_UNVERIFIED';
ALTER TABLE "BomHeader" ADD COLUMN "releasedAt" TIMESTAMP(3);
ALTER TABLE "BomHeader" ADD COLUMN "releasedById" TEXT;
ALTER TABLE "BomLine" ADD COLUMN "unit" TEXT;
ALTER TABLE "RecipeHeader" ADD COLUMN "status" "EngineeringStatus" NOT NULL DEFAULT 'LEGACY_UNVERIFIED';
ALTER TABLE "RecipeHeader" ADD COLUMN "releasedAt" TIMESTAMP(3);
ALTER TABLE "RecipeHeader" ADD COLUMN "releasedById" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "plantId" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "productionDefinitionId" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "engineeringSnapshot" JSONB;
ALTER TABLE "WorkOrder" ADD COLUMN "engineeringReleasedAt" TIMESTAMP(3);
ALTER TABLE "WorkOrder" ADD COLUMN "engineeringReleaseRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ProductionDefinition" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "bomHeaderId" TEXT NOT NULL,
  "recipeHeaderId" TEXT NOT NULL,
  "status" "EngineeringStatus" NOT NULL DEFAULT 'DRAFT',
  "releasedAt" TIMESTAMP(3),
  "releasedById" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionDefinition_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionDefinition_tenantId_plantId_partId_status_idx" ON "ProductionDefinition"("tenantId", "plantId", "partId", "status");
CREATE INDEX "ProductionDefinition_tenantId_bomHeaderId_idx" ON "ProductionDefinition"("tenantId", "bomHeaderId");
CREATE INDEX "ProductionDefinition_tenantId_recipeHeaderId_idx" ON "ProductionDefinition"("tenantId", "recipeHeaderId");
ALTER TABLE "ProductionDefinition" ADD CONSTRAINT "ProductionDefinition_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionDefinition" ADD CONSTRAINT "ProductionDefinition_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionDefinition" ADD CONSTRAINT "ProductionDefinition_bomHeaderId_fkey" FOREIGN KEY ("bomHeaderId") REFERENCES "BomHeader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionDefinition" ADD CONSTRAINT "ProductionDefinition_recipeHeaderId_fkey" FOREIGN KEY ("recipeHeaderId") REFERENCES "RecipeHeader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "WorkOrder_tenantId_plantId_idx" ON "WorkOrder"("tenantId", "plantId");

CREATE TABLE "UomDefinition" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "dimension" "UomDimension" NOT NULL,
  "factorToBase" DECIMAL(24,12) NOT NULL,
  "decimalPlaces" INTEGER NOT NULL DEFAULT 6,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UomDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UomDefinition_tenantId_code_key" ON "UomDefinition"("tenantId", "code");
CREATE INDEX "UomDefinition_tenantId_dimension_idx" ON "UomDefinition"("tenantId", "dimension");

CREATE TABLE "PlantProductionCalendar" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "weeklyWorkingDays" JSONB NOT NULL,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlantProductionCalendar_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlantProductionCalendar_tenantId_plantId_name_key" ON "PlantProductionCalendar"("tenantId", "plantId", "name");
CREATE INDEX "PlantProductionCalendar_tenantId_plantId_isActive_idx" ON "PlantProductionCalendar"("tenantId", "plantId", "isActive");
ALTER TABLE "PlantProductionCalendar" ADD CONSTRAINT "PlantProductionCalendar_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlantProductionCalendarException" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "calendarId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "isWorking" BOOLEAN NOT NULL,
  "name" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlantProductionCalendarException_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlantProductionCalendarException_calendarId_date_key" ON "PlantProductionCalendarException"("calendarId", "date");
CREATE INDEX "PlantProductionCalendarException_tenantId_calendarId_date_idx" ON "PlantProductionCalendarException"("tenantId", "calendarId", "date");
ALTER TABLE "PlantProductionCalendarException" ADD CONSTRAINT "PlantProductionCalendarException_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "PlantProductionCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductionShift" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "calendarId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionShift_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductionShift_tenantId_plantId_code_key" ON "ProductionShift"("tenantId", "plantId", "code");
CREATE INDEX "ProductionShift_tenantId_plantId_isActive_idx" ON "ProductionShift"("tenantId", "plantId", "isActive");
ALTER TABLE "ProductionShift" ADD CONSTRAINT "ProductionShift_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionShift" ADD CONSTRAINT "ProductionShift_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "PlantProductionCalendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Database-level final guard against two concurrent releases choosing different
-- definitions for the same tenant, plant, and part revision.
CREATE UNIQUE INDEX "ProductionDefinition_one_released_per_plant_part"
  ON "ProductionDefinition"("tenantId", "plantId", "partId")
  WHERE "status" = 'RELEASED';

-- New engineering records default to DRAFT. Existing records remain honestly
-- classified as LEGACY_UNVERIFIED until a controlled release is performed.
ALTER TABLE "Part" ALTER COLUMN "engineeringStatus" SET DEFAULT 'DRAFT';
ALTER TABLE "BomHeader" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "RecipeHeader" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
