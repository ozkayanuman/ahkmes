-- CreateEnum
CREATE TYPE "MachineEventType" AS ENUM ('CYCLE_START', 'CYCLE_END', 'PART_COMPLETE', 'ALARM', 'IDLE');

-- CreateTable
CREATE TABLE "MachineStatusEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "type" "MachineEventType" NOT NULL,
    "message" TEXT,
    "workOrderId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineStatusEvent_tenantId_machineId_occurredAt_idx" ON "MachineStatusEvent"("tenantId", "machineId", "occurredAt");

-- AddForeignKey
ALTER TABLE "MachineStatusEvent" ADD CONSTRAINT "MachineStatusEvent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
