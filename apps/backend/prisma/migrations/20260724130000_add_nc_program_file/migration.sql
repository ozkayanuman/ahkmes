-- AlterTable
ALTER TABLE "NcProgram" ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "storageKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "NcProgram_storageKey_key" ON "NcProgram"("storageKey");
