import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InventoryMovementType, Prisma, PurchaseOrderStatus } from "@prisma/client";
import type {
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { nextDocNo } from "../common/numbering";
import { InventoryService } from "../inventory/inventory.service";

// RECEIVED durumuna sadece receive endpoint'i geçirir
const TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  ORDERED: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

const PO_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  lines: {
    include: {
      material: {
        select: { id: true, code: true, name: true, unit: true, stockQty: true, lotTrackingRequired: true },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly outbox: OutboxService,
  ) {}

  findAll(tenantId: string, status?: PurchaseOrderStatus, q?: string) {
    return this.prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { poNo: { contains: q, mode: "insensitive" as const } },
                { supplier: { name: { contains: q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: PO_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: PO_INCLUDE,
    });
    if (!po) throw new NotFoundException("Satınalma emri bulunamadı");
    return po;
  }

  async create(tenantId: string, userId: string, dto: CreatePurchaseOrderDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      const po = await this.createInTransaction(tx, tenantId, userId, dto);
      await this.outbox.record(tx, tenantId, "purchaseorder", po.id, "purchaseorder.updated", { id: po.id });
      return po;
    });
    return created;
  }

  /** MRP gibi üst command'lerin PO ve karar kayıtlarını aynı transaction'a alması için. */
  async createInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    dto: CreatePurchaseOrderDto,
  ) {
    const supplier = await tx.supplier.findFirst({ where: { id: dto.supplierId, tenantId } });
    if (!supplier) throw new NotFoundException("Tedarikçi bulunamadı");
    const materialIds = dto.lines.map((l) => l.materialId);
    const materials = await tx.material.findMany({ where: { id: { in: materialIds }, tenantId } });
    if (materials.length !== new Set(materialIds).size) {
      throw new NotFoundException("Malzeme bulunamadı");
    }

    const poNo = await nextDocNo(tx, "purchaseOrder", "poNo", "SAT");
    return tx.purchaseOrder.create({
      data: {
        tenantId, poNo, supplierId: dto.supplierId, currency: dto.currency, orderDate: dto.orderDate,
        expectedDate: dto.expectedDate, notes: dto.notes, createdById: userId,
        lines: { create: dto.lines.map((l) => ({ tenantId, materialId: l.materialId, quantity: l.quantity, unitPrice: l.unitPrice })) },
      },
      include: PO_INCLUDE,
    });
  }

  async update(tenantId: string, id: string, dto: UpdatePurchaseOrderDto) {
    const po = await this.findOne(tenantId, id);
    if (po.status === "RECEIVED" || po.status === "CANCELLED") {
      throw new ConflictException("Tamamlanmış/iptal edilmiş sipariş düzenlenemez");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({
        where: { id },
        data: dto,
        include: PO_INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "purchaseorder", id, "purchaseorder.updated", { id });
      return result;
    });
    return updated;
  }

  async setStatus(tenantId: string, id: string, status: PurchaseOrderStatus) {
    const po = await this.findOne(tenantId, id);
    if (!TRANSITIONS[po.status].includes(status)) {
      throw new ConflictException(`Geçersiz durum geçişi: ${po.status} → ${status}`);
    }
    if (status === "CANCELLED" && po.lines.some((l) => Number(l.receivedQty) > 0)) {
      throw new ConflictException("Kısmi teslim alınmış sipariş iptal edilemez");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({
        where: { id },
        data: { status },
        include: PO_INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "purchaseorder", id, "purchaseorder.updated", { id, status });
      return result;
    });
    return updated;
  }

  /**
   * Satır bazlı teslim alma: immutable hareket, bin bakiyesi ve toplam stok
   * projeksiyonu aynı transaction'da güncellenir; tüm satırlar tamamsa PO RECEIVED olur.
   */
  async receive(tenantId: string, userId: string, id: string, dto: ReceivePurchaseOrderDto) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, tenantId },
        include: {
          lines: {
            include: {
              material: { select: { id: true, code: true, lotTrackingRequired: true } },
            },
          },
        },
      });
      if (!po) throw new NotFoundException("Satınalma emri bulunamadı");
      if (po.status !== "ORDERED" && po.status !== "IN_TRANSIT") {
        throw new ConflictException(`${po.status} durumundaki sipariş teslim alınamaz`);
      }

      for (const item of dto.lines) {
        const line = po.lines.find((l) => l.id === item.lineId);
        if (!line) throw new NotFoundException("Sipariş satırı bulunamadı");
        const newReceived = Number(line.receivedQty) + item.receivedQty;
        if (newReceived > Number(line.quantity) + 1e-9) {
          throw new ConflictException(
            `Fazla teslim reddedildi: sipariş ${Number(line.quantity)}, toplam teslim ${newReceived}`,
          );
        }
        if (line.material.lotTrackingRequired && !item.lotId) {
          throw new ConflictException(`Lot takibi zorunlu ${line.material.code} malzemesi için lot seçimi gerekir`);
        }
        if (item.lotId) {
          const lot = await tx.lot.findFirst({
            where: { id: item.lotId, tenantId, itemType: "MATERIAL", itemId: line.materialId },
          });
          if (!lot) throw new NotFoundException("Lot bulunamadı veya sipariş malzemesine ait değil");
          if (lot.acceptanceStatus !== "ACCEPTED") {
            throw new ConflictException("Satın alma tesliminde sadece kabul edilmiş malzeme lotu stoğa alınabilir");
          }
        }
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQty: { increment: item.receivedQty } },
        });
        await this.inventory.record(tx, {
          tenantId,
          itemType: "MATERIAL",
          itemId: line.materialId,
          quantityDelta: item.receivedQty,
          movementType: InventoryMovementType.PURCHASE_RECEIPT,
          sourceType: "PURCHASE_ORDER",
          sourceId: po.id,
          sourceLineId: line.id,
          binId: item.binId,
          lotId: item.lotId,
          createdById: userId,
        });
      }

      const freshLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: id },
      });
      const allReceived = freshLines.every((l) => Number(l.receivedQty) >= Number(l.quantity));
      const result = await tx.purchaseOrder.update({
        where: { id },
        data: allReceived ? { status: "RECEIVED" } : {},
        include: PO_INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "purchaseorder", id, "stock.updated", {
        lineIds: dto.lines.map((l) => l.lineId),
      });
      await this.outbox.record(tx, tenantId, "purchaseorder", id, "purchaseorder.updated", { id, status: result.status });
      return result;
    });

    return updated;
  }

  async remove(tenantId: string, id: string) {
    const po = await this.findOne(tenantId, id);
    if (po.status === "RECEIVED" || po.lines.some((l) => Number(l.receivedQty) > 0)) {
      throw new ConflictException("Teslim alınmış sipariş silinemez");
    }
    const deleted = await this.prisma.$transaction(async (tx) => {
      const removed = await tx.purchaseOrder.delete({ where: { id } });
      await this.outbox.record(tx, tenantId, "purchaseorder", id, "purchaseorder.updated", { id, deleted: true });
      return removed;
    });
    return deleted;
  }
}
