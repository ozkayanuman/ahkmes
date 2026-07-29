-- AlterTable
ALTER TABLE "NonConformance" ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "resolvedById" TEXT;

-- AddForeignKey
ALTER TABLE "NonConformance" ADD CONSTRAINT "NonConformance_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
