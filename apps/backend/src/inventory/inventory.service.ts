import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  InventoryMovementType,
  Prisma,
  StockItemType,
  type InventoryMovement,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { writeTransactionalAudit } from "../common/transactional-audit";

export interface RecordInventoryMovementInput {
  tenantId: string;
  itemType: StockItemType;
  itemId: string;
  quantityDelta: number;
  movementType: InventoryMovementType;
  sourceType: string;
  sourceId: string;
  sourceLineId?: string;
  binId?: string;
  lotId?: string;
  createdById?: string;
  occurredAt?: Date;
  note?: string;
}

/**
 * AHK-003 inventory write boundary. All stock-changing use cases call this
 * service inside their existing database transaction. It atomically updates the
 * location balance and legacy aggregate projections, then appends an immutable
 * movement. No caller writes StockBalance/Material.stockQty/PartStock directly.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  findMovements(
    tenantId: string,
    filters: { itemId?: string; binId?: string; sourceType?: string; sourceId?: string } = {},
  ) {
    return this.prisma.inventoryMovement.findMany({
      where: { tenantId, ...filters },
      include: {
        bin: { select: { id: true, code: true, warehouse: { select: { id: true, name: true } } } },
        lot: { select: { id: true, lotNo: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    });
  }

  async record(tx: Prisma.TransactionClient, input: RecordInventoryMovementInput): Promise<InventoryMovement> {
    if (!Number.isFinite(input.quantityDelta) || input.quantityDelta === 0) {
      throw new ConflictException("Stok hareket miktarı sıfır olamaz");
    }

    await this.assertItemAndLot(tx, input);
    const bin = await this.resolveBin(tx, input.tenantId, input.binId);
    const balanceAfter = await this.adjustBalance(tx, { ...input, binId: bin.id });

    if (input.itemType === "MATERIAL") {
      const materialUpdated = await tx.material.updateMany({
        where: { id: input.itemId, tenantId: input.tenantId },
        data: { stockQty: { increment: input.quantityDelta } },
      });
      if (materialUpdated.count === 0) throw new NotFoundException("Stok kalemi bulunamadı");
    } else {
      await tx.partStock.upsert({
        where: { partId: input.itemId },
        update: { qty: { increment: input.quantityDelta } },
        create: { tenantId: input.tenantId, partId: input.itemId, qty: input.quantityDelta },
      });
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        tenantId: input.tenantId,
        movementType: input.movementType,
        itemType: input.itemType,
        itemId: input.itemId,
        binId: bin.id,
        lotId: input.lotId,
        quantityDelta: input.quantityDelta,
        balanceAfter,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineId: input.sourceLineId,
        note: input.note,
        createdById: input.createdById,
        occurredAt: input.occurredAt,
      },
    });

    // All callers already hold the domain command's transaction. A failed audit
    // write therefore rolls back the movement, balance, and aggregate projection.
    if (input.createdById) {
      await writeTransactionalAudit(tx, {
        tenantId: input.tenantId,
        userId: input.createdById,
        entity: "inventory-movements",
        entityId: movement.id,
        action: "CREATE",
        after: movement,
      });
    }
    return movement;
  }

  private async assertItemAndLot(tx: Prisma.TransactionClient, input: RecordInventoryMovementInput) {
    const item =
      input.itemType === "MATERIAL"
        ? await tx.material.findFirst({ where: { id: input.itemId, tenantId: input.tenantId } })
        : await tx.part.findFirst({ where: { id: input.itemId, tenantId: input.tenantId } });
    if (!item) throw new NotFoundException("Stok kalemi bulunamadı");

    if (input.lotId) {
      const lot = await tx.lot.findFirst({
        where: {
          id: input.lotId,
          tenantId: input.tenantId,
          itemType: input.itemType,
          itemId: input.itemId,
        },
      });
      if (!lot) throw new NotFoundException("Lot bulunamadı veya stok kalemine ait değil");
    }
  }

  private async resolveBin(tx: Prisma.TransactionClient, tenantId: string, requestedBinId?: string) {
    if (requestedBinId) {
      const bin = await tx.bin.findFirst({ where: { id: requestedBinId, tenantId } });
      if (!bin) throw new NotFoundException("Raf (bin) bulunamadı");
      return bin;
    }

    const systemWarehouseName = "Sistem - Atanmamış Stok";
    let warehouse = await tx.warehouse.findFirst({ where: { tenantId, name: systemWarehouseName } });
    if (!warehouse) {
      warehouse = await tx.warehouse.create({
        data: { tenantId, name: systemWarehouseName, code: "SYSTEM" },
      });
    }
    let bin = await tx.bin.findFirst({ where: { tenantId, warehouseId: warehouse.id, code: "UNASSIGNED" } });
    if (!bin) {
      bin = await tx.bin.create({
        data: { tenantId, warehouseId: warehouse.id, code: "UNASSIGNED", name: "Lokasyonu bilinmeyen stok" },
      });
    }
    return bin;
  }

  private async adjustBalance(
    tx: Prisma.TransactionClient,
    input: RecordInventoryMovementInput & { binId: string },
  ): Promise<Prisma.Decimal> {
    if (input.quantityDelta < 0) {
      const rows = await tx.$queryRaw<Array<{ qty: Prisma.Decimal }>>(Prisma.sql`
        UPDATE "StockBalance"
        SET "qty" = "qty" + ${input.quantityDelta}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "tenantId" = ${input.tenantId}
          AND "binId" = ${input.binId}
          AND "itemType" = ${input.itemType}::"StockItemType"
          AND "itemId" = ${input.itemId}
          AND "lotId" IS NOT DISTINCT FROM ${input.lotId ?? null}
          AND "qty" + ${input.quantityDelta} >= 0
        RETURNING "qty"
      `);
      if (rows.length === 0) {
        throw new ConflictException("Yetersiz stok: seçilen rafta istenen miktar yok");
      }
      return rows[0].qty;
    }

    const rows = await tx.$queryRaw<Array<{ qty: Prisma.Decimal }>>(Prisma.sql`
      INSERT INTO "StockBalance" (
        "id", "tenantId", "binId", "itemType", "itemId", "lotId", "qty", "updatedAt"
      )
      SELECT ${randomUUID()}, ${input.tenantId}, ${input.binId}, ${input.itemType}::"StockItemType",
        ${input.itemId}, ${input.lotId ?? null}, ${input.quantityDelta}, CURRENT_TIMESTAMP
      ON CONFLICT ("tenantId", "binId", "itemType", "itemId", (COALESCE("lotId", '')))
      DO UPDATE SET
        "qty" = "StockBalance"."qty" + EXCLUDED."qty",
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "StockBalance"."qty" + EXCLUDED."qty" >= 0
      RETURNING "qty"
    `);
    if (rows.length === 0) {
      throw new ConflictException("Yetersiz stok: seçilen rafta istenen miktar yok");
    }
    return rows[0].qty;
  }
}
