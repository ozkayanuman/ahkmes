-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED');

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "leadTimeDays" INTEGER;

-- CreateTable
CREATE TABLE "BomHeader" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "revision" TEXT NOT NULL DEFAULT 'A',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BomHeader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bomHeaderId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qtyPer" DECIMAL(18,6) NOT NULL,
    "scrapPct" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BomLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseProposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ppNo" TEXT NOT NULL,
    "supplierId" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "convertedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseProposalLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseProposalId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "neededByDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseProposalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionProposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prNo" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "convertedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BomHeader_tenantId_partId_isActive_idx" ON "BomHeader"("tenantId", "partId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BomHeader_tenantId_partId_revision_key" ON "BomHeader"("tenantId", "partId", "revision");

-- CreateIndex
CREATE INDEX "BomLine_tenantId_bomHeaderId_idx" ON "BomLine"("tenantId", "bomHeaderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseProposal_ppNo_key" ON "PurchaseProposal"("ppNo");

-- CreateIndex
CREATE INDEX "PurchaseProposal_tenantId_status_idx" ON "PurchaseProposal"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PurchaseProposalLine_tenantId_purchaseProposalId_idx" ON "PurchaseProposalLine"("tenantId", "purchaseProposalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionProposal_prNo_key" ON "ProductionProposal"("prNo");

-- CreateIndex
CREATE INDEX "ProductionProposal_tenantId_status_idx" ON "ProductionProposal"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "BomHeader" ADD CONSTRAINT "BomHeader_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_bomHeaderId_fkey" FOREIGN KEY ("bomHeaderId") REFERENCES "BomHeader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseProposal" ADD CONSTRAINT "PurchaseProposal_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseProposalLine" ADD CONSTRAINT "PurchaseProposalLine_purchaseProposalId_fkey" FOREIGN KEY ("purchaseProposalId") REFERENCES "PurchaseProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseProposalLine" ADD CONSTRAINT "PurchaseProposalLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProposal" ADD CONSTRAINT "ProductionProposal_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
