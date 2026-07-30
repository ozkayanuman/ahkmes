import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateFinishedGoodsDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const INCLUDE = {
  part: { select: { id: true, partNo: true, revision: true, name: true } },
  workOrder: { select: { id: true, woNo: true, quantity: true, status: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class FinishedGoodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  findAll(tenantId: string, workOrderId?: string) {
    return this.prisma.finishedGoodsEntry.findMany({
      where: { tenantId, ...(workOrderId ? { workOrderId } : {}) },
      include: INCLUDE,
      orderBy: { date: "desc" },
    });
  }

  /** Mamul stok özeti (PartStock) */
  stocks(tenantId: string) {
    return this.prisma.partStock.findMany({
      where: { tenantId },
      include: { part: { select: { id: true, partNo: true, revision: true, name: true } } },
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * Mamul girişi: PartStock aynı transaction'da artar.
   * Toplam üretilen >= iş emri miktarı ise tamamlama önerilir (kullanıcı onaylar).
   */
  async create(tenantId: string, userId: string, dto: CreateFinishedGoodsDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findFirst({ where: { id: dto.workOrderId, tenantId } });
      if (!wo) throw new NotFoundException("İş emri bulunamadı");
      if (wo.status === "COMPLETED" || wo.status === "CANCELLED") {
        throw new ConflictException("Tamamlanmış/iptal edilmiş iş emrine mamul girişi yapılamaz");
      }
      if (dto.lotId) {
        const lot = await tx.lot.findFirst({
          where: { id: dto.lotId, tenantId, itemType: "PART", itemId: wo.partId },
        });
        if (!lot) throw new NotFoundException("Lot bulunamadı veya bu parçaya ait değil");
      }

      const entry = await tx.finishedGoodsEntry.create({
        data: {
          tenantId,
          workOrderId: wo.id,
          partId: wo.partId,
          quantity: dto.quantity,
          date: dto.date ?? new Date(),
          createdById: userId,
          lotId: dto.lotId,
        },
        include: INCLUDE,
      });

      await tx.partStock.upsert({
        where: { partId: wo.partId },
        update: { qty: { increment: dto.quantity } },
        create: { tenantId, partId: wo.partId, qty: dto.quantity },
      });

      const agg = await tx.finishedGoodsEntry.aggregate({
        where: { workOrderId: wo.id },
        _sum: { quantity: true },
      });
      const totalProduced = Number(agg._sum.quantity ?? 0);
      return {
        entry,
        totalProduced,
        // Öneri: kullanıcı iş emrini /work-orders/:id/status ile COMPLETED yapar
        completionSuggested: totalProduced >= Number(wo.quantity),
      };
    });

    this.realtime.emitToTenant(tenantId, "stock.updated", { partId: result.entry.part.id });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id: dto.workOrderId });
    return result;
  }
}
