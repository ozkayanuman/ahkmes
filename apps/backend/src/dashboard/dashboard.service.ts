import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(tenantId: string) {
    const [woGroups, activeWorkOrders, pendingQuotes, minStockMaterials, recentRuns, openNonConformanceCount] =
      await Promise.all([
        this.prisma.workOrder.groupBy({
          by: ["status"],
          where: { tenantId },
          _count: { _all: true },
        }),
        this.prisma.workOrder.findMany({
          where: { tenantId, status: { in: ["PLANNED", "WAITING_MATERIAL", "IN_PRODUCTION"] } },
          include: {
            part: { select: { id: true, partNo: true, name: true } },
            machine: { select: { id: true, name: true } },
          },
          orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
          take: 10,
        }),
        this.prisma.quote.findMany({
          where: { tenantId, status: { in: ["DRAFT", "SENT"] } },
          include: { customer: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        // Kolonlar arası karşılaştırma Prisma filtresiyle yapılamıyor — JS'te süz
        this.prisma.material.findMany({
          where: { tenantId, minStock: { not: null } },
        }),
        this.prisma.productionRun.findMany({
          where: { tenantId },
          include: {
            workOrder: {
              select: { id: true, woNo: true, part: { select: { partNo: true, name: true } } },
            },
            operator: { select: { id: true, name: true } },
          },
          orderBy: { startedAt: "desc" },
          take: 5,
        }),
        this.prisma.nonConformance.count({ where: { tenantId, status: "OPEN" } }),
      ]);

    const workOrderCounts: Record<string, number> = {};
    for (const g of woGroups) workOrderCounts[g.status] = g._count._all;

    const criticalStock = minStockMaterials.filter(
      (m) => Number(m.stockQty) < Number(m.minStock),
    );

    return {
      workOrderCounts,
      activeWorkOrders,
      pendingQuotes,
      criticalStock,
      recentRuns,
      openNonConformanceCount,
    };
  }
}
