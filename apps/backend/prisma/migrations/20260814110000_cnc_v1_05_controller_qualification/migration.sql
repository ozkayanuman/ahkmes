-- CNC-V1-05 controller observations are additive and forward-only. Existing
-- manual machines remain outside controller verification by default.
CREATE TYPE "ControllerConnectionState" AS ENUM ('UNKNOWN', 'CONNECTING', 'ONLINE', 'DEGRADED', 'OFFLINE');
CREATE TYPE "ControllerMachineState" AS ENUM ('UNKNOWN', 'IDLE', 'READY', 'RUNNING', 'FEED_HOLD', 'ALARM', 'STOPPED', 'OFFLINE');
CREATE TYPE "ControllerObservationTrust" AS ENUM ('SIMULATED', 'CONFIGURED', 'OBSERVED', 'CONTROLLER_VERIFIED');

ALTER TABLE "Machine"
  ADD COLUMN "controllerVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "controllerFreshnessSeconds" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "Machine" ADD CONSTRAINT "Machine_id_tenantId_key" UNIQUE ("id", "tenantId");

CREATE TABLE "MachineControllerObservation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "controllerTimestamp" TIMESTAMP(3),
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "connectionState" "ControllerConnectionState" NOT NULL,
  "machineState" "ControllerMachineState" NOT NULL,
  "trustLevel" "ControllerObservationTrust" NOT NULL,
  "activeProgramIdentity" TEXT,
  "activeProgramChecksum" TEXT,
  "alarmCode" TEXT,
  "alarmText" TEXT,
  "partCounter" INTEGER,
  "connectionGeneration" INTEGER NOT NULL DEFAULT 0,
  "capabilities" JSONB,
  "raw" JSONB,
  CONSTRAINT "MachineControllerObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MachineControllerObservation_machineId_idempotencyKey_key" UNIQUE ("machineId", "idempotencyKey"),
  CONSTRAINT "MachineControllerObservation_machine_tenant_fkey" FOREIGN KEY ("machineId", "tenantId") REFERENCES "Machine"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MachineControllerObservation_tenant_machine_ingested_idx" ON "MachineControllerObservation"("tenantId", "machineId", "ingestedAt");
CREATE INDEX "MachineControllerObservation_tenant_machine_connection_ingested_idx" ON "MachineControllerObservation"("tenantId", "machineId", "connectionState", "ingestedAt");
