-- Immutable evidence for an incoming lot's acceptance decision.
CREATE TYPE "IncomingLotInspectionDecision" AS ENUM ('ACCEPTED', 'QUARANTINED', 'REJECTED');

CREATE TABLE "IncomingLotInspection" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "lotId" TEXT NOT NULL,
  "decision" "IncomingLotInspectionDecision" NOT NULL,
  "note" TEXT,
  "inspectedById" TEXT NOT NULL,
  "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IncomingLotInspection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IncomingLotInspection_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "IncomingLotInspection_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "IncomingLotInspection_tenantId_lotId_inspectedAt_idx"
  ON "IncomingLotInspection"("tenantId", "lotId", "inspectedAt");
