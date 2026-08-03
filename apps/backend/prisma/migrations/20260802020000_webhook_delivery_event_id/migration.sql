-- AHK-009: Aynı dış olay yeniden yayınlanırsa abonelik başına yalnızca bir teslim
-- satırı oluşur. Mevcut geçmiş satırlarında kendi id'si güvenli benzersiz anahtardır.
ALTER TABLE "WebhookDeliveryEvent" ADD COLUMN "eventId" TEXT;
UPDATE "WebhookDeliveryEvent" SET "eventId" = "id" WHERE "eventId" IS NULL;
ALTER TABLE "WebhookDeliveryEvent" ALTER COLUMN "eventId" SET NOT NULL;
CREATE UNIQUE INDEX "WebhookDeliveryEvent_subscriptionId_eventId_key"
  ON "WebhookDeliveryEvent"("subscriptionId", "eventId");
