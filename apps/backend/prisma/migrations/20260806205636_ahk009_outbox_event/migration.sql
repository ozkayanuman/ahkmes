-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'DISPATCHED', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_tenantId_status_occurredAt_idx" ON "OutboxEvent"("tenantId", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");
