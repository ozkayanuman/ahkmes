/*
  Warnings:

  - You are about to drop the column `materialId` on the `BomLine` table. All the data in the column will be lost.
  - Added the required column `itemId` to the `BomLine` table without a default value. This is not possible if the table is not empty.
  - Added the required column `itemType` to the `BomLine` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "BomLine" DROP CONSTRAINT "BomLine_materialId_fkey";

-- Backfill: mevcut tüm BomLine satırları Material'dı (yeni itemType/itemId
-- eklenmeden önce tek tür destekleniyordu) — geriye dönük veri kaybı yok.
ALTER TABLE "BomLine" ADD COLUMN "itemId" TEXT;
ALTER TABLE "BomLine" ADD COLUMN "itemType" "StockItemType";
UPDATE "BomLine" SET "itemId" = "materialId", "itemType" = 'MATERIAL';
ALTER TABLE "BomLine" ALTER COLUMN "itemId" SET NOT NULL;
ALTER TABLE "BomLine" ALTER COLUMN "itemType" SET NOT NULL;
ALTER TABLE "BomLine" DROP COLUMN "materialId";

-- CreateIndex
CREATE INDEX "BomLine_tenantId_itemType_itemId_idx" ON "BomLine"("tenantId", "itemType", "itemId");
