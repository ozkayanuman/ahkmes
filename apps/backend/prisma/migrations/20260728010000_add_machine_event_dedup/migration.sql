-- CreateTable
CREATE TABLE "MachineEventDedup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineEventDedup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineEventDedup_tenantId_idx" ON "MachineEventDedup"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineEventDedup_machineId_eventId_key" ON "MachineEventDedup"("machineId", "eventId");
