import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateConsumptionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const INCLUDE = {
  material: { select: { id: true, code: true, name: true, unit: true, stockQty: true } },
  workOrder: { select: { id: true, woNo: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ConsumptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  findAll(tenantId: string, workOrderId?: string) {
    return this.prisma.materialConsumption.findMany({
      where: { tenantId, ...(workOrderId ? { workOrderId } : {}) },
      include: INCLUDE,
      orderBy: { date: "desc" },
    });
  }

  /**
   * RESERVED: stok düşmez, sadece ayrılmış gösterilir.
   * CONSUMED: aynı transaction'da stok düşer; yetersiz stok 409.
   */
  async create(tenantId: string, userId: string, dto: CreateConsumptionDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findFirst({ where: { id: dto.workOrderId, tenantId } });
      if (!wo) throw new NotFoundException("İş emri bulunamadı");
      if (wo.status === "COMPLETED" || wo.status === "CANCELLED") {
        throw new ConflictException("Tamamlanmış/iptal edilmiş iş emrine kayıt eklenemez");
      }
      const material = await tx.material.findFirst({ where: { id: dto.materialId, tenantId } });
      if (!material) throw new NotFoundException("Malzeme bulunamadı");
      if (dto.lotId) {
        const lot = await tx.lot.findFirst({
          where: { id: dto.lotId, tenantId, itemType: "MATERIAL", itemId: dto.materialId },
        });
        if (!lot) throw new NotFoundException("Lot bulunamadı veya bu malzemeye ait değil");
      }

      if (dto.type === "CONSUMED") {
        if (Number(material.stockQty) < dto.quantity) {
          throw new ConflictException(
            `Yetersiz stok: mevcut ${Number(material.stockQty)}, istenen ${dto.quantity}`,
          );
        }
        await tx.material.update({
          where: { id: material.id },
          data: { stockQty: { decrement: dto.quantity } },
        });
      }

      return tx.materialConsumption.create({
        data: {
          tenantId,
          workOrderId: dto.workOrderId,
          materialId: dto.materialId,
          type: dto.type,
          quantity: dto.quantity,
          date: dto.date ?? new Date(),
          createdById: userId,
          lotId: dto.lotId,
        },
        include: INCLUDE,
      });
    });

    if (dto.type === "CONSUMED") {
      this.realtime.emitToTenant(tenantId, "stock.updated", { materialId: dto.materialId });
    }
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id: dto.workOrderId });
    return created;
  }

  /** Silme tüketimi geri alır: CONSUMED kayıtta stok iade edilir. */
  async remove(tenantId: string, id: string) {
    const deleted = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.materialConsumption.findFirst({ where: { id, tenantId } });
      if (!entry) throw new NotFoundException("Tüketim kaydı bulunamadı");
      if (entry.type === "CONSUMED") {
        await tx.material.update({
          where: { id: entry.materialId },
          data: { stockQty: { increment: entry.quantity } },
        });
      }
      return tx.materialConsumption.delete({ where: { id } });
    });
    this.realtime.emitToTenant(tenantId, "stock.updated", { materialId: deleted.materialId });
    return deleted;
  }
}
