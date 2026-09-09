-- CreateEnum
CREATE TYPE "DowntimeReasonCategory" AS ENUM ('PLANNED', 'UNPLANNED');

-- CreateEnum
CREATE TYPE "DowntimeEventSource" AS ENUM ('ALARM', 'MANUAL');

-- CreateTable
CREATE TABLE "DowntimeReason" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "DowntimeReasonCategory" NOT NULL DEFAULT 'UNPLANNED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DowntimeReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DowntimeEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "reasonId" TEXT,
    "source" "DowntimeEventSource" NOT NULL,
    "note" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "triggeredById" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DowntimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DowntimeReason_tenantId_idx" ON "DowntimeReason"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DowntimeReason_tenantId_code_key" ON "DowntimeReason"("tenantId", "code");

-- CreateIndex
CREATE INDEX "DowntimeEvent_tenantId_machineId_endedAt_idx" ON "DowntimeEvent"("tenantId", "machineId", "endedAt");

-- CreateIndex
CREATE INDEX "DowntimeEvent_tenantId_startedAt_idx" ON "DowntimeEvent"("tenantId", "startedAt");

-- AddForeignKey
ALTER TABLE "DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "DowntimeReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
