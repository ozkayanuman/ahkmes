import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateOpportunityDto, UpdateOpportunityDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

const OPEN_STAGES = ["NEW", "QUALIFIED", "PROPOSAL"] as const;

@Injectable()
export class OpportunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  /** customerId verilmezse tenant genelinde satış hattı (pipeline) görünümü için
   * kullanılır — bu yüzden müşteri adı her zaman include edilir. */
  findAll(tenantId: string, customerId?: string) {
    return this.prisma.opportunity.findMany({
      where: { tenantId, ...(customerId ? { customerId } : {}) },
      include: { customer: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Aşama bazlı sayı + tahmini değer toplamı — açık aşamalar (NEW/QUALIFIED/
   * PROPOSAL) için satış hattının o anki büyüklüğünü, WON/LOST için kapanmış
   * hacmi gösterir. Değeri boş fırsatlar toplamı etkilemez (0 sayılır).
   */
  async pipelineSummary(tenantId: string) {
    const rows = await this.prisma.opportunity.groupBy({
      by: ["stage"],
      where: { tenantId },
      _count: { _all: true },
      _sum: { estimatedValue: true },
    });
    const byStage = new Map(rows.map((r) => [r.stage, { count: r._count._all, totalValue: r._sum.estimatedValue }]));
    const stages = ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
    const summary = stages.map((stage) => ({
      stage,
      count: byStage.get(stage)?.count ?? 0,
      totalValue: byStage.get(stage)?.totalValue ?? null,
    }));
    const openTotalValue = summary
      .filter((s) => (OPEN_STAGES as readonly string[]).includes(s.stage))
      .reduce((sum, s) => sum + Number(s.totalValue ?? 0), 0);
    return { byStage: summary, openTotalValue };
  }

  async findOne(tenantId: string, id: string) {
    const opp = await this.prisma.opportunity.findFirst({ where: { id, tenantId } });
    if (!opp) throw new NotFoundException("Fırsat bulunamadı");
    return opp;
  }

  async create(tenantId: string, dto: CreateOpportunityDto) {
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } });
    if (!customer) throw new NotFoundException("Müşteri bulunamadı");
    return this.prisma.opportunity.create({ data: { ...dto, tenantId } });
  }

  /**
   * Stage WON/LOST'a geçince wonAt/lostAt otomatik damgalanır — kullanıcının
   * ayrıca bir "kapat" aksiyonu tetiklemesine gerek yok, PATCH tek adımda
   * yeterli (MaintenanceOrder/Inspection'daki durum geçiş desenlerinden daha
   * basit, çünkü burada onay akışı veya cihaz tetikli otomasyon yok).
   */
  async update(tenantId: string, id: string, dto: UpdateOpportunityDto) {
    const opp = await this.findOne(tenantId, id);
    const data: UpdateOpportunityDto & { wonAt?: Date; lostAt?: Date } = { ...dto };
    if (dto.stage === "WON" && opp.stage !== "WON") data.wonAt = new Date();
    if (dto.stage === "LOST" && opp.stage !== "LOST") data.lostAt = new Date();
    return this.prisma.opportunity.update({ where: { id: opp.id }, data });
  }

  async remove(tenantId: string, id: string) {
    const opp = await this.findOne(tenantId, id);
    return this.prisma.opportunity.delete({ where: { id: opp.id } });
  }
}
