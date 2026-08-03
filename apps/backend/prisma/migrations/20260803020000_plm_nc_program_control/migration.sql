-- PLM-001: controlled NC revisions. Existing rows deliberately become DRAFT
-- with an empty checksum: a legacy file cannot be mistaken for a reviewed,
-- released manufacturing instruction without an explicit new revision.
CREATE TYPE "NcProgramStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');
CREATE TYPE "NcProgramSignatureAction" AS ENUM ('APPROVE', 'PUBLISH');

ALTER TABLE "NcProgram"
  ADD COLUMN "checksum" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "checksumAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256',
  ADD COLUMN "status" "NcProgramStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "effectivityScope" TEXT NOT NULL DEFAULT 'GLOBAL',
  ADD COLUMN "effectiveFrom" TIMESTAMP(3),
  ADD COLUMN "effectiveTo" TIMESTAMP(3),
  ADD COLUMN "parentRevisionId" TEXT,
  ADD COLUMN "approvalRequestId" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "publishedById" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "supersededAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "RecipeStep" ADD COLUMN "ncProgramId" TEXT;
ALTER TABLE "WorkOrderOperation"
  ADD COLUMN "ncProgramId" TEXT,
  ADD COLUMN "ncProgramVersion" INTEGER,
  ADD COLUMN "ncProgramChecksum" TEXT,
  ADD COLUMN "ncProgramFileName" TEXT,
  ADD COLUMN "ncProgramStorageKey" TEXT;

CREATE TABLE "NcProgramSignature" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ncProgramId" TEXT NOT NULL,
  "action" "NcProgramSignatureAction" NOT NULL,
  "signerId" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "authSource" "UserAuthSource" NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NcProgramSignature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NcProgram_approvalRequestId_key" ON "NcProgram"("approvalRequestId");
CREATE INDEX "NcProgram_tenantId_partId_status_idx" ON "NcProgram"("tenantId", "partId", "status");
CREATE INDEX "NcProgram_tenantId_approvalRequestId_idx" ON "NcProgram"("tenantId", "approvalRequestId");
CREATE UNIQUE INDEX "NcProgramSignature_ncProgramId_action_key" ON "NcProgramSignature"("ncProgramId", "action");
CREATE INDEX "NcProgramSignature_tenantId_ncProgramId_idx" ON "NcProgramSignature"("tenantId", "ncProgramId");
CREATE INDEX "RecipeStep_tenantId_ncProgramId_idx" ON "RecipeStep"("tenantId", "ncProgramId");
CREATE INDEX "WorkOrderOperation_tenantId_ncProgramId_idx" ON "WorkOrderOperation"("tenantId", "ncProgramId");

-- Authoritative last line of defence against simultaneous release commands.
-- A scope has exactly one PUBLISHED revision; an existing one must first be
-- superseded in the same transaction.
CREATE UNIQUE INDEX "NcProgram_one_published_per_part_scope"
  ON "NcProgram"("partId", "effectivityScope")
  WHERE "status" = 'PUBLISHED';

ALTER TABLE "NcProgram" ADD CONSTRAINT "NcProgram_parentRevisionId_fkey"
  FOREIGN KEY ("parentRevisionId") REFERENCES "NcProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NcProgram" ADD CONSTRAINT "NcProgram_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NcProgram" ADD CONSTRAINT "NcProgram_publishedById_fkey"
  FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecipeStep" ADD CONSTRAINT "RecipeStep_ncProgramId_fkey"
  FOREIGN KEY ("ncProgramId") REFERENCES "NcProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_ncProgramId_fkey"
  FOREIGN KEY ("ncProgramId") REFERENCES "NcProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NcProgramSignature" ADD CONSTRAINT "NcProgramSignature_ncProgramId_fkey"
  FOREIGN KEY ("ncProgramId") REFERENCES "NcProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NcProgramSignature" ADD CONSTRAINT "NcProgramSignature_signerId_fkey"
  FOREIGN KEY ("signerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
