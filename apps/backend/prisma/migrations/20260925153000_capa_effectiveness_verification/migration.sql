-- CAPA cannot be closed on approval alone. Effectiveness verification is a
-- separate, attributable quality decision and remains nullable for historic rows.
ALTER TABLE "Capa" ADD COLUMN "effectivenessEvidence" TEXT;
ALTER TABLE "Capa" ADD COLUMN "effectivenessVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Capa" ADD COLUMN "effectivenessVerifiedById" TEXT;

ALTER TABLE "Capa"
  ADD CONSTRAINT "Capa_effectivenessVerifiedById_fkey"
  FOREIGN KEY ("effectivenessVerifiedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Capa_tenantId_effectivenessVerifiedAt_idx"
  ON "Capa"("tenantId", "effectivenessVerifiedAt");
