-- CRM sales follow-up: an append-only activity history plus a small, indexed
-- next-action projection for actionable pipeline views.
CREATE TYPE "OpportunityActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING');

ALTER TABLE "Opportunity" ADD COLUMN "nextFollowUpAt" TIMESTAMP(3);

CREATE TABLE "OpportunityActivity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" "OpportunityActivityType" NOT NULL,
    "note" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextFollowUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Opportunity_tenantId_nextFollowUpAt_idx" ON "Opportunity"("tenantId", "nextFollowUpAt");
CREATE INDEX "OpportunityActivity_tenantId_opportunityId_occurredAt_idx" ON "OpportunityActivity"("tenantId", "opportunityId", "occurredAt");

ALTER TABLE "OpportunityActivity"
  ADD CONSTRAINT "OpportunityActivity_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityActivity"
  ADD CONSTRAINT "OpportunityActivity_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
