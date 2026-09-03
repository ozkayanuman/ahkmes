-- CNC-V1-03R release closure: explicit SalesOrderLine plant provenance and
-- explainable REPEATABLE READ snapshot identity.
ALTER TABLE "MrpRun"
  ADD COLUMN "inputSnapshotAt" TIMESTAMP(3),
  ADD COLUMN "inputSnapshotStrategy" TEXT,
  ADD COLUMN "inputSnapshotVersion" INTEGER;

ALTER TABLE "SalesOrderLine" ADD COLUMN "fulfillmentPlantId" TEXT;

CREATE INDEX "SalesOrderLine_tenantId_fulfillmentPlantId_dueDate_idx"
  ON "SalesOrderLine"("tenantId", "fulfillmentPlantId", "dueDate");

ALTER TABLE "SalesOrderLine"
  ADD CONSTRAINT "SalesOrderLine_fulfillmentPlantId_tenantId_fkey"
  FOREIGN KEY ("fulfillmentPlantId", "tenantId")
  REFERENCES "Plant"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL sequences are deliberately non-MVCC. This avoids allocating a
-- duplicate proposal number from a stale REPEATABLE READ snapshot when runs
-- for different plants publish concurrently. Gaps after rollback are valid.
CREATE SEQUENCE "MrpProposalNumberSeq" START 1;
SELECT setval(
  '"MrpProposalNumberSeq"',
  COALESCE((SELECT MAX(((regexp_match("proposalNo", '([0-9]+)$'))[1])::bigint) FROM "MrpProposal"), 0) + 1,
  false
);
