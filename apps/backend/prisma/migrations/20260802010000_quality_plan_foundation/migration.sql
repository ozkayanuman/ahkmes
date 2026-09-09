CREATE TABLE "QualityPlan" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "revision" TEXT NOT NULL DEFAULT 'A', "partId" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QualityPlan_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "QualityPlanCheck" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "qualityPlanId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL, "checkpointName" TEXT NOT NULL, "operationSeq" INTEGER,
  "unit" TEXT, "lowerLimit" DECIMAL(18,6), "upperLimit" DECIMAL(18,6),
  "requiresMeasurement" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityPlanCheck_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Inspection" ADD COLUMN "qualityPlanCheckId" TEXT, ADD COLUMN "measurementValue" DECIMAL(18,6), ADD COLUMN "measurementUnit" TEXT;
CREATE UNIQUE INDEX "QualityPlan_tenantId_name_revision_key" ON "QualityPlan"("tenantId", "name", "revision");
CREATE INDEX "QualityPlan_tenantId_partId_isActive_idx" ON "QualityPlan"("tenantId", "partId", "isActive");
CREATE UNIQUE INDEX "QualityPlanCheck_qualityPlanId_seq_key" ON "QualityPlanCheck"("qualityPlanId", "seq");
CREATE INDEX "QualityPlanCheck_tenantId_qualityPlanId_idx" ON "QualityPlanCheck"("tenantId", "qualityPlanId");
CREATE INDEX "Inspection_tenantId_qualityPlanCheckId_idx" ON "Inspection"("tenantId", "qualityPlanCheckId");
ALTER TABLE "QualityPlan" ADD CONSTRAINT "QualityPlan_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QualityPlanCheck" ADD CONSTRAINT "QualityPlanCheck_qualityPlanId_fkey" FOREIGN KEY ("qualityPlanId") REFERENCES "QualityPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_qualityPlanCheckId_fkey" FOREIGN KEY ("qualityPlanCheckId") REFERENCES "QualityPlanCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
