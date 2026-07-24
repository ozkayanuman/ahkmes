import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PurchaseOrderStatus } from "@prisma/client";
import type {
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { nextDocNo } from "../common/numbering";

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
      material: { select: { id: true, code: true, name: true, unit: true, stockQty: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
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
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId },
    });
    if (!supplier) throw new NotFoundException("Tedarikçi bulunamadı");
    const materialIds = dto.lines.map((l) => l.materialId);
    const materials = await this.prisma.material.findMany({
      where: { id: { in: materialIds }, tenantId },
    });
    if (materials.length !== new Set(materialIds).size) {
      throw new NotFoundException("Malzeme bulunamadı");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const poNo = await nextDocNo(tx, "purchaseOrder", "poNo", "SAT");
      return tx.purchaseOrder.create({
        data: {
          tenantId,
          poNo,
          supplierId: dto.supplierId,
          orderDate: dto.orderDate,
          expectedDate: dto.expectedDate,
          notes: dto.notes,
          createdById: userId,
          lines: {
            create: dto.lines.map((l) => ({
              tenantId,
              materialId: l.materialId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
            })),
          },
        },
        include: PO_INCLUDE,
      });
    });
    this.realtime.emitToTenant(tenantId, "purchaseorder.updated", { id: created.id });
    return created;
  }

  async update(tenantId: string, id: string, dto: UpdatePurchaseOrderDto) {
    const po = await this.findOne(tenantId, id);
    if (po.status === "RECEIVED" || po.status === "CANCELLED") {
      throw new ConflictException("Tamamlanmış/iptal edilmiş sipariş düzenlenemez");
    }
    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: dto,
      include: PO_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "purchaseorder.updated", { id });
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
    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status },
      include: PO_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "purchaseorder.updated", { id, status });
    return updated;
  }

  /**
   * Satır bazlı teslim alma: receivedQty artar, Material.stockQty aynı
   * transaction'da artar; tüm satırlar tamamsa PO RECEIVED olur.
   */
  async receive(tenantId: string, id: string, dto: ReceivePurchaseOrderDto) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, tenantId },
        include: { lines: true },
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
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQty: { increment: item.receivedQty } },
        });
        await tx.material.update({
          where: { id: line.materialId },
          data: { stockQty: { increment: item.receivedQty } },
        });
      }

      const freshLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: id },
      });
      const allReceived = freshLines.every((l) => Number(l.receivedQty) >= Number(l.quantity));
      return tx.purchaseOrder.update({
        where: { id },
        data: allReceived ? { status: "RECEIVED" } : {},
        include: PO_INCLUDE,
      });
    });

    this.realtime.emitToTenant(tenantId, "stock.updated", {
      lineIds: dto.lines.map((l) => l.lineId),
    });
    this.realtime.emitToTenant(tenantId, "purchaseorder.updated", { id, status: updated.status });
    return updated;
  }

  async remove(tenantId: string, id: string) {
    const po = await this.findOne(tenantId, id);
    if (po.status === "RECEIVED" || po.lines.some((l) => Number(l.receivedQty) > 0)) {
      throw new ConflictException("Teslim alınmış sipariş silinemez");
    }
    const deleted = await this.prisma.purchaseOrder.delete({ where: { id } });
    this.realtime.emitToTenant(tenantId, "purchaseorder.updated", { id, deleted: true });
    return deleted;
  }
}
