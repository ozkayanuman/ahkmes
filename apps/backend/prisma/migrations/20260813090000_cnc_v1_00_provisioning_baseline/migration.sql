-- CNC-V1-00: additive tenant identity/defaults for deterministic customer
-- provisioning. Existing tenants remain valid and can be assigned a code later.
ALTER TABLE "Tenant" ADD COLUMN "code" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'tr';
ALTER TABLE "Tenant" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul';
CREATE UNIQUE INDEX "Tenant_code_key" ON "Tenant"("code");

ALTER TABLE "Machine" ADD COLUMN "connectorAdapter" TEXT;
ALTER TABLE "Machine" ADD COLUMN "connectorConnectionState" TEXT;
ALTER TABLE "Machine" ADD COLUMN "connectorLastCommunicationAt" TIMESTAMP(3);
ALTER TABLE "Machine" ADD COLUMN "connectorLastErrorCategory" TEXT;
ALTER TABLE "Machine" ADD COLUMN "connectorReconnecting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Machine" ADD COLUMN "connectorConfigValid" BOOLEAN;
ALTER TABLE "Machine" ADD COLUMN "connectorStatusUpdatedAt" TIMESTAMP(3);
