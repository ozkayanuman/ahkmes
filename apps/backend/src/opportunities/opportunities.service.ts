import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateOpportunityDto, UpdateOpportunityDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class OpportunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, customerId?: string) {
    return this.prisma.opportunity.findMany({
      where: { tenantId, ...(customerId ? { customerId } : {}) },
      orderBy: { createdAt: "desc" },
    });
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
