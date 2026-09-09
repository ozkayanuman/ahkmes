import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InventoryMovementType } from "@prisma/client";
import type { CreateDeliveryDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { nextDocNo } from "../common/numbering";
import { InventoryService } from "../inventory/inventory.service";

const DELIVERY_INCLUDE = {
  salesOrder: { select: { id: true, soNo: true } },
  createdBy: { select: { id: true, name: true } },
  lines: {
    include: {
      salesOrderLine: {
        select: { id: true, part: { select: { id: true, partNo: true, name: true } } },
      },
    },
  },
} as const;

/** Sevkiyat — tek seferlik olay (FinishedGoodsEntry gibi taslak durumu yok).
 * Oluşturulunca SalesOrderLine.shippedQty artar ve PartStock.qty düşer —
 * yetersiz stok durumunda tüm işlem (transaction) geri alınır. */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly outbox: OutboxService,
  ) {}

  findAll(tenantId: string, salesOrderId?: string) {
    return this.prisma.delivery.findMany({
      where: { tenantId, ...(salesOrderId ? { salesOrderId } : {}) },
      include: DELIVERY_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const dlv = await this.prisma.delivery.findFirst({ where: { id, tenantId }, include: DELIVERY_INCLUDE });
    if (!dlv) throw new NotFoundException("Sevkiyat bulunamadı");
    return dlv;
  }

  async create(tenantId: string, userId: string, dto: CreateDeliveryDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      // Sipariş ve miktar kontrolleri transaction içinde taze veriyle yapılır —
      // aksi halde iki eşzamanlı sevkiyat isteği aynı "kalan miktar" anlık
      // görüntüsünü kullanıp ikisi de geçerse sipariş miktarı aşılabilir
      // (bkz. purchasing.service.ts receive() aynı deseni kullanır).
      const so = await tx.salesOrder.findFirst({
        where: { id: dto.salesOrderId, tenantId },
        include: { lines: { include: { part: { select: { id: true, partNo: true } } } } },
      });
      if (!so) throw new NotFoundException("Satış siparişi bulunamadı");
      if (so.status !== "OPEN") {
        throw new ConflictException("Sadece açık (OPEN) sipariş için sevkiyat oluşturulabilir");
      }

      const lineById = new Map(so.lines.map((l) => [l.id, l]));
      for (const l of dto.lines) {
        const line = lineById.get(l.salesOrderLineId);
        if (!line) throw new NotFoundException("Sipariş satırı bulunamadı");
        const remaining = Number(line.quantity) - Number(line.shippedQty);
        if (l.qty > remaining + 1e-9) {
          throw new ConflictException(
            `Fazla sevkiyat reddedildi: ${line.part.partNo} — sipariş ${Number(line.quantity)}, kalan sevk edilebilir ${remaining}`,
          );
        }
      }

      const dlvNo = await nextDocNo(tx, "delivery", "dlvNo", "SEV");
      const delivery = await tx.delivery.create({
        data: {
          tenantId,
          dlvNo,
          salesOrderId: dto.salesOrderId,
          notes: dto.notes,
          createdById: userId,
          lines: {
            create: dto.lines.map((l) => ({
              tenantId,
              salesOrderLineId: l.salesOrderLineId,
              qty: l.qty,
              binId: l.binId,
              lotId: l.lotId,
            })),
          },
        },
        include: DELIVERY_INCLUDE,
      });

      for (const l of dto.lines) {
        const line = lineById.get(l.salesOrderLineId)!;
        await tx.salesOrderLine.update({
          where: { id: l.salesOrderLineId },
          data: { shippedQty: { increment: l.qty } },
        });

        const deliveryLine = delivery.lines.find((dl) => dl.salesOrderLine.id === l.salesOrderLineId);
        await this.inventory.record(tx, {
          tenantId,
          itemType: "PART",
          itemId: line.partId,
          quantityDelta: -l.qty,
          movementType: InventoryMovementType.DELIVERY,
          sourceType: "DELIVERY",
          sourceId: delivery.id,
          sourceLineId: deliveryLine?.id,
          binId: l.binId,
          lotId: l.lotId,
          createdById: userId,
        });
      }

      await this.outbox.record(tx, tenantId, "delivery", delivery.id, "delivery.created", { id: delivery.id, salesOrderId: dto.salesOrderId });
      await this.outbox.record(tx, tenantId, "delivery", delivery.id, "stock.updated", { reason: "delivery", deliveryId: delivery.id });
      await this.outbox.record(tx, tenantId, "delivery", delivery.id, "salesorder.updated", { id: dto.salesOrderId });

      return delivery;
    });

    return created;
  }
}
