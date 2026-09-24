-- AHK-013 Copilot Gateway Milestone 2: persistent draft/approval record.
-- Approval only flips CopilotDraft.status to APPROVED; it never executes the
-- underlying mutation (material.create etc.) by itself.
CREATE TYPE "CopilotDraftStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'NOT_APPROVABLE');

CREATE TABLE "CopilotDraft" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "status" "CopilotDraftStatus" NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedById" TEXT,
  "rejectedAt" TIMESTAMP(3),

  CONSTRAINT "CopilotDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CopilotDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CopilotDraft_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CopilotDraft_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CopilotDraft_tenantId_status_createdAt_idx" ON "CopilotDraft"("tenantId", "status", "createdAt");
