CREATE TYPE "ToolPresetStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

CREATE TABLE "ToolPresetRecord" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "physicalToolInstanceId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "offsetNumber" INTEGER NOT NULL,
  "lengthOffset" DECIMAL(18,3) NOT NULL,
  "radiusOffset" DECIMAL(18,3),
  "measuredAt" TIMESTAMP(3) NOT NULL,
  "status" "ToolPresetStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT NOT NULL,
  "createdById" TEXT,
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ToolPresetRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ToolPresetRecord_physicalToolInstanceId_fkey" FOREIGN KEY ("physicalToolInstanceId") REFERENCES "PhysicalToolInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ToolPresetRecord_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ToolPresetRecord_tenantId_physicalToolInstanceId_machineId_offsetNumber_status_idx"
  ON "ToolPresetRecord"("tenantId", "physicalToolInstanceId", "machineId", "offsetNumber", "status");
CREATE INDEX "ToolPresetRecord_tenantId_machineId_status_measuredAt_idx"
  ON "ToolPresetRecord"("tenantId", "machineId", "status", "measuredAt");
CREATE UNIQUE INDEX "ToolPresetRecord_one_active_offset_per_tool_machine_key"
  ON "ToolPresetRecord"("tenantId", "physicalToolInstanceId", "machineId", "offsetNumber")
  WHERE "status" = 'ACTIVE';
