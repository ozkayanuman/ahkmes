-- AHK-003: append-only inventory ledger. Existing summary and bin balances are
-- retained as projections so an upgrade does not discard any operational data.
CREATE TYPE "InventoryMovementType" AS ENUM (
  'OPENING_BALANCE',
  'PURCHASE_RECEIPT',
  'CONSUMPTION',
  'CONSUMPTION_REVERSAL',
  'FINISHED_GOODS_RECEIPT',
  'DELIVERY',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'CYCLE_COUNT_ADJUSTMENT'
);

ALTER TABLE "MaterialConsumption" ADD COLUMN "binId" TEXT;
ALTER TABLE "FinishedGoodsEntry" ADD COLUMN "binId" TEXT;
ALTER TABLE "DeliveryLine" ADD COLUMN "binId" TEXT;
ALTER TABLE "DeliveryLine" ADD COLUMN "lotId" TEXT;

CREATE TABLE "InventoryMovement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "movementType" "InventoryMovementType" NOT NULL,
  "itemType" "StockItemType" NOT NULL,
  "itemId" TEXT NOT NULL,
  "binId" TEXT NOT NULL,
  "lotId" TEXT,
  "quantityDelta" DECIMAL(18,3) NOT NULL,
  "balanceAfter" DECIMAL(18,3) NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceLineId" TEXT,
  "note" TEXT,
  "createdById" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_binId_fkey"
  FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "InventoryMovement_tenantId_itemType_itemId_occurredAt_idx"
  ON "InventoryMovement"("tenantId", "itemType", "itemId", "occurredAt");
CREATE INDEX "InventoryMovement_tenantId_binId_occurredAt_idx"
  ON "InventoryMovement"("tenantId", "binId", "occurredAt");
CREATE INDEX "InventoryMovement_tenantId_sourceType_sourceId_idx"
  ON "InventoryMovement"("tenantId", "sourceType", "sourceId");

-- Old StockBalance did not have a database unique key for null lot IDs. Merge
-- accidental duplicate projections before adding the proper expression index.
WITH grouped AS (
  SELECT min("id") AS keep_id, "tenantId", "binId", "itemType", "itemId", "lotId", sum("qty") AS total_qty
  FROM "StockBalance"
  GROUP BY "tenantId", "binId", "itemType", "itemId", "lotId"
)
UPDATE "StockBalance" b SET "qty" = g.total_qty
FROM grouped g WHERE b."id" = g.keep_id;

WITH grouped AS (
  SELECT min("id") AS keep_id, "tenantId", "binId", "itemType", "itemId", "lotId"
  FROM "StockBalance"
  GROUP BY "tenantId", "binId", "itemType", "itemId", "lotId"
)
DELETE FROM "StockBalance" b
USING grouped g
WHERE b."tenantId" = g."tenantId"
  AND b."binId" = g."binId"
  AND b."itemType" = g."itemType"
  AND b."itemId" = g."itemId"
  AND b."lotId" IS NOT DISTINCT FROM g."lotId"
  AND b."id" <> g.keep_id;

CREATE UNIQUE INDEX "StockBalance_tenant_bin_item_lot_key"
  ON "StockBalance"("tenantId", "binId", "itemType", "itemId", COALESCE("lotId", ''));

-- Legacy totals had no physical location. Create a clearly-labelled virtual bin
-- per tenant; new API clients may provide a real bin, while old clients remain
-- compatible and their quantities are never silently dropped.
WITH tenants AS (
  SELECT "tenantId" FROM "Material"
  UNION SELECT "tenantId" FROM "PartStock"
  UNION SELECT "tenantId" FROM "StockBalance"
)
INSERT INTO "Warehouse" ("id", "tenantId", "name", "code", "createdAt", "updatedAt")
SELECT 'system-unassigned-warehouse-' || "tenantId", "tenantId", 'Sistem - Atanmamış Stok', 'SYSTEM', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM tenants
ON CONFLICT ("tenantId", "name") DO NOTHING;

WITH tenants AS (
  SELECT "tenantId" FROM "Material"
  UNION SELECT "tenantId" FROM "PartStock"
  UNION SELECT "tenantId" FROM "StockBalance"
)
INSERT INTO "Bin" ("id", "tenantId", "warehouseId", "code", "name", "createdAt", "updatedAt")
SELECT 'system-unassigned-bin-' || t."tenantId", t."tenantId", w."id", 'UNASSIGNED', 'Lokasyonu bilinmeyen eski stok', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM tenants t
JOIN "Warehouse" w ON w."tenantId" = t."tenantId" AND w."name" = 'Sistem - Atanmamış Stok'
ON CONFLICT ("warehouseId", "code") DO NOTHING;

-- Existing bin records become opening movements first.
INSERT INTO "InventoryMovement" (
  "id", "tenantId", "movementType", "itemType", "itemId", "binId", "lotId",
  "quantityDelta", "balanceAfter", "sourceType", "sourceId", "occurredAt", "createdAt"
)
SELECT 'legacy-stock-balance-' || b."id", b."tenantId", 'OPENING_BALANCE', b."itemType", b."itemId", b."binId", b."lotId",
  b."qty", b."qty", 'LEGACY_STOCK_BALANCE', b."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "StockBalance" b
WHERE b."qty" <> 0;

-- Reconcile each old material total against its detailed bins. The delta is
-- stored in the virtual bin (including a negative delta if legacy data was
-- already inconsistent), preserving the old total and making the discrepancy visible.
WITH deltas AS (
  SELECT m."tenantId", m."id" AS item_id, m."stockQty" - COALESCE(sum(b."qty"), 0) AS qty
  FROM "Material" m
  LEFT JOIN "StockBalance" b ON b."tenantId" = m."tenantId" AND b."itemType" = 'MATERIAL' AND b."itemId" = m."id"
  GROUP BY m."tenantId", m."id", m."stockQty"
), upserted AS (
  INSERT INTO "StockBalance" ("id", "tenantId", "binId", "itemType", "itemId", "qty", "updatedAt")
  SELECT 'system-unassigned-material-' || d.item_id, d."tenantId", b."id", 'MATERIAL', d.item_id, d.qty, CURRENT_TIMESTAMP
  FROM deltas d
  JOIN "Bin" b ON b."tenantId" = d."tenantId" AND b."code" = 'UNASSIGNED'
  WHERE d.qty <> 0
  ON CONFLICT ("tenantId", "binId", "itemType", "itemId", (COALESCE("lotId", '')))
  DO UPDATE SET "qty" = "StockBalance"."qty" + EXCLUDED."qty", "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "tenantId", "binId", "itemType", "itemId", "qty"
)
INSERT INTO "InventoryMovement" (
  "id", "tenantId", "movementType", "itemType", "itemId", "binId", "quantityDelta", "balanceAfter", "sourceType", "sourceId", "occurredAt", "createdAt"
)
SELECT 'legacy-material-total-' || d.item_id, u."tenantId", 'OPENING_BALANCE', 'MATERIAL', d.item_id, u."binId", d.qty, u."qty", 'LEGACY_MATERIAL_TOTAL', d.item_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM deltas d JOIN upserted u ON u."tenantId" = d."tenantId" AND u."itemId" = d.item_id;

WITH deltas AS (
  SELECT p."tenantId", p."partId" AS item_id, p."qty" - COALESCE(sum(b."qty"), 0) AS qty
  FROM "PartStock" p
  LEFT JOIN "StockBalance" b ON b."tenantId" = p."tenantId" AND b."itemType" = 'PART' AND b."itemId" = p."partId"
  GROUP BY p."tenantId", p."partId", p."qty"
), upserted AS (
  INSERT INTO "StockBalance" ("id", "tenantId", "binId", "itemType", "itemId", "qty", "updatedAt")
  SELECT 'system-unassigned-part-' || d.item_id, d."tenantId", b."id", 'PART', d.item_id, d.qty, CURRENT_TIMESTAMP
  FROM deltas d
  JOIN "Bin" b ON b."tenantId" = d."tenantId" AND b."code" = 'UNASSIGNED'
  WHERE d.qty <> 0
  ON CONFLICT ("tenantId", "binId", "itemType", "itemId", (COALESCE("lotId", '')))
  DO UPDATE SET "qty" = "StockBalance"."qty" + EXCLUDED."qty", "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "tenantId", "binId", "itemType", "itemId", "qty"
)
INSERT INTO "InventoryMovement" (
  "id", "tenantId", "movementType", "itemType", "itemId", "binId", "quantityDelta", "balanceAfter", "sourceType", "sourceId", "occurredAt", "createdAt"
)
SELECT 'legacy-part-total-' || d.item_id, u."tenantId", 'OPENING_BALANCE', 'PART', d.item_id, u."binId", d.qty, u."qty", 'LEGACY_PART_TOTAL', d.item_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM deltas d JOIN upserted u ON u."tenantId" = d."tenantId" AND u."itemId" = d.item_id;

CREATE OR REPLACE FUNCTION inventory_movement_prevent_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'InventoryMovement kayitlari degistirilemez veya silinemez (immutable inventory ledger)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_movement_immutable
BEFORE UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION inventory_movement_prevent_update_delete();
