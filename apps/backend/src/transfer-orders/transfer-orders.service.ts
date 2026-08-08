import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateTransferOrderDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { nextDocNo } from "../common/numbering";
import { InventoryService } from "../inventory/inventory.service";
import { InventoryMovementType } from "@prisma/client";

const TO_INCLUDE = {
  fromBin: { select: { id: true, code: true, warehouse: { select: { id: true, name: true } } } },
  toBin: { select: { id: true, code: true, warehouse: { select: { id: true, name: true } } } },
  createdBy: { select: { id: true, name: true } },
  lines: true,
} as const;

/** Bin→Bin transfer — Delivery gibi tek seferlik olay (oluşturulunca anında
 * gerçekleşir). Kaynak ve hedef kontrol/güncellemeleri transaction içinde
 * taze veriyle yapılır (bkz. delivery.service.ts — aynı race-condition
 * önleme deseni). */
@Injectable()
export class TransferOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly outbox: OutboxService,
  ) {}

  findAll(tenantId: string, binId?: string) {
    return this.prisma.transferOrder.findMany({
      where: { tenantId, ...(binId ? { OR: [{ fromBinId: binId }, { toBinId: binId }] } : {}) },
      include: TO_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const to = await this.prisma.transferOrder.findFirst({ where: { id, tenantId }, include: TO_INCLUDE });
    if (!to) throw new NotFoundException("Transfer emri bulunamadı");
    return to;
  }

  async create(tenantId: string, userId: string, dto: CreateTransferOrderDto) {
    if (dto.fromBinId === dto.toBinId) {
      throw new ConflictException("Kaynak ve hedef raf aynı olamaz");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const [fromBin, toBin] = await Promise.all([
        tx.bin.findFirst({ where: { id: dto.fromBinId, tenantId } }),
        tx.bin.findFirst({ where: { id: dto.toBinId, tenantId } }),
      ]);
      if (!fromBin) throw new NotFoundException("Kaynak raf bulunamadı");
      if (!toBin) throw new NotFoundException("Hedef raf bulunamadı");

      const toNo = await nextDocNo(tx, "transferOrder", "toNo", "TRF");
      const transfer = await tx.transferOrder.create({
        data: {
          tenantId,
          toNo,
          fromBinId: dto.fromBinId,
          toBinId: dto.toBinId,
          notes: dto.notes,
          createdById: userId,
          lines: {
            create: dto.lines.map((l) => ({
              tenantId,
              itemType: l.itemType,
              itemId: l.itemId,
              lotId: l.lotId,
              qty: l.qty,
            })),
          },
        },
        include: TO_INCLUDE,
      });
      for (const line of transfer.lines) {
        await this.inventory.record(tx, {
          tenantId,
          itemType: line.itemType,
          itemId: line.itemId,
          quantityDelta: -Number(line.qty),
          movementType: InventoryMovementType.TRANSFER_OUT,
          sourceType: "TRANSFER_ORDER",
          sourceId: transfer.id,
          sourceLineId: line.id,
          binId: dto.fromBinId,
          lotId: line.lotId ?? undefined,
          createdById: userId,
        });
        await this.inventory.record(tx, {
          tenantId,
          itemType: line.itemType,
          itemId: line.itemId,
          quantityDelta: Number(line.qty),
          movementType: InventoryMovementType.TRANSFER_IN,
          sourceType: "TRANSFER_ORDER",
          sourceId: transfer.id,
          sourceLineId: line.id,
          binId: dto.toBinId,
          lotId: line.lotId ?? undefined,
          createdById: userId,
        });
      }
      await this.outbox.record(tx, tenantId, "transferorder", transfer.id, "transferorder.created", { id: transfer.id });
      await this.outbox.record(tx, tenantId, "transferorder", transfer.id, "stock.updated", { reason: "transfer", transferOrderId: transfer.id });

      return transfer;
    });

    return created;
  }
}
