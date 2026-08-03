-- AHK-009: kalıcı webhook teslim kuyruğu, retry ve dead-letter kaydı.
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD_LETTER');

CREATE TABLE "WebhookDeliveryEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookDeliveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDeliveryEvent_status_nextAttemptAt_idx" ON "WebhookDeliveryEvent"("status", "nextAttemptAt");
CREATE INDEX "WebhookDeliveryEvent_tenantId_status_occurredAt_idx" ON "WebhookDeliveryEvent"("tenantId", "status", "occurredAt");
CREATE INDEX "WebhookDeliveryEvent_subscriptionId_idx" ON "WebhookDeliveryEvent"("subscriptionId");
