/*
  Warnings:

  - You are about to drop the column `materialId` on the `MaterialConsumption` table. All the data in the column will be lost.
  - Added the required column `itemId` to the `MaterialConsumption` table without a default value. This is not possible if the table is not empty.
  - Added the required column `itemType` to the `MaterialConsumption` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "MaterialConsumption" DROP CONSTRAINT "MaterialConsumption_materialId_fkey";

-- Backfill: mevcut tüm MaterialConsumption satırları Material'dı (yeni
-- itemType/itemId eklenmeden önce tek tür destekleniyordu) — geriye dönük
-- veri kaybı yok.
ALTER TABLE "MaterialConsumption" ADD COLUMN "itemId" TEXT;
ALTER TABLE "MaterialConsumption" ADD COLUMN "itemType" "StockItemType";
UPDATE "MaterialConsumption" SET "itemId" = "materialId", "itemType" = 'MATERIAL';
ALTER TABLE "MaterialConsumption" ALTER COLUMN "itemId" SET NOT NULL;
ALTER TABLE "MaterialConsumption" ALTER COLUMN "itemType" SET NOT NULL;
ALTER TABLE "MaterialConsumption" DROP COLUMN "materialId";

-- CreateIndex
CREATE INDEX "MaterialConsumption_tenantId_itemType_itemId_idx" ON "MaterialConsumption"("tenantId", "itemType", "itemId");
