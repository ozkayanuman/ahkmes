-- Faz G+ General Ledger: chart of accounts, fiscal periods, journal entries and
-- subledger posting map. Journal entries from AR/AP are idempotent through the
-- (tenantId, sourceType, sourceId) unique constraint.
CREATE TYPE "GlAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');
CREATE TYPE "GlSourceType" AS ENUM ('MANUAL', 'CUSTOMER_INVOICE', 'SUPPLIER_INVOICE', 'CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT');
CREATE TYPE "GlPostingKey" AS ENUM ('AR_RECEIVABLE', 'SALES_REVENUE', 'AP_PAYABLE', 'PURCHASE_EXPENSE', 'BANK');

CREATE TABLE "GlAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GlAccountType" NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "postingAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GlPostingAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" "GlPostingKey" NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "GlPostingAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FiscalPeriod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jeNo" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" "GlSourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "reversalOfId" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlAccount_tenantId_code_key" ON "GlAccount"("tenantId", "code");
CREATE INDEX "GlAccount_tenantId_type_idx" ON "GlAccount"("tenantId", "type");
CREATE UNIQUE INDEX "GlPostingAccount_tenantId_key_key" ON "GlPostingAccount"("tenantId", "key");
CREATE UNIQUE INDEX "FiscalPeriod_tenantId_year_month_key" ON "FiscalPeriod"("tenantId", "year", "month");
CREATE UNIQUE INDEX "JournalEntry_jeNo_key" ON "JournalEntry"("jeNo");
CREATE UNIQUE INDEX "JournalEntry_reversalOfId_key" ON "JournalEntry"("reversalOfId");
CREATE UNIQUE INDEX "JournalEntry_tenantId_sourceType_sourceId_key" ON "JournalEntry"("tenantId", "sourceType", "sourceId");
CREATE INDEX "JournalEntry_tenantId_entryDate_idx" ON "JournalEntry"("tenantId", "entryDate");
CREATE INDEX "JournalEntry_tenantId_status_idx" ON "JournalEntry"("tenantId", "status");
CREATE INDEX "JournalLine_tenantId_accountId_idx" ON "JournalLine"("tenantId", "accountId");
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");

ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "GlAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GlPostingAccount" ADD CONSTRAINT "GlPostingAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FiscalPeriod" ADD CONSTRAINT "FiscalPeriod_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
