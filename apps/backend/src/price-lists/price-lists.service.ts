import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreatePriceListDto, UpdatePriceListDto, UpsertPriceListLineDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PriceListsService {
  constructor(private readonly prisma: PrismaService) {}

  listPriceLists(tenantId: string, customerId?: string) {
    return this.prisma.priceList.findMany({
      where: { tenantId, ...(customerId ? { customerId } : {}) },
      include: { customer: { select: { id: true, name: true } }, _count: { select: { lines: true } } },
      orderBy: [{ customerId: "asc" }, { name: "asc" }],
    });
  }

  async createPriceList(tenantId: string, dto: CreatePriceListDto) {
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } });
      if (!customer) throw new NotFoundException("Müşteri bulunamadı");
    }
    if (dto.effectiveFrom && dto.effectiveTo && dto.effectiveFrom > dto.effectiveTo) {
      throw new ConflictException("Geçerlilik bitişi başlangıçtan önce olamaz");
    }
    return this.prisma.priceList.create({
      data: {
        tenantId, name: dto.name, currency: dto.currency.toUpperCase(), customerId: dto.customerId ?? null,
        effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo,
      },
    });
  }

  async updatePriceList(tenantId: string, id: string, dto: UpdatePriceListDto) {
    const existing = await this.prisma.priceList.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException("Fiyat listesi bulunamadı");
    return this.prisma.priceList.update({ where: { id }, data: dto });
  }

  async listLines(tenantId: string, priceListId: string) {
    const priceList = await this.prisma.priceList.findFirst({ where: { id: priceListId, tenantId } });
    if (!priceList) throw new NotFoundException("Fiyat listesi bulunamadı");
    return this.prisma.priceListLine.findMany({
      where: { tenantId, priceListId },
      include: { part: { select: { id: true, partNo: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async upsertLine(tenantId: string, priceListId: string, dto: UpsertPriceListLineDto) {
    const priceList = await this.prisma.priceList.findFirst({ where: { id: priceListId, tenantId } });
    if (!priceList) throw new NotFoundException("Fiyat listesi bulunamadı");
    const part = await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    return this.prisma.priceListLine.upsert({
      where: { priceListId_partId: { priceListId, partId: dto.partId } },
      create: { tenantId, priceListId, partId: dto.partId, unitPrice: dto.unitPrice, discountPercent: dto.discountPercent ?? null },
      update: { unitPrice: dto.unitPrice, discountPercent: dto.discountPercent ?? null },
    });
  }

  async removeLine(tenantId: string, priceListId: string, lineId: string) {
    const line = await this.prisma.priceListLine.findFirst({ where: { id: lineId, tenantId, priceListId } });
    if (!line) throw new NotFoundException("Fiyat listesi satırı bulunamadı");
    await this.prisma.priceListLine.delete({ where: { id: line.id } });
    return { id: line.id };
  }

  /**
   * Resolves the price a customer should see for a part: an active,
   * currently-effective customer-specific list wins over the active
   * default (customerId null) list. Returns null if neither has a line for
   * this part — callers keep their existing manual-entry fallback.
   */
  async resolve(tenantId: string, partId: string, customerId?: string) {
    const now = new Date();
    const activeEffective = {
      isActive: true,
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
      ],
    };
    const candidateListIds = (
      await this.prisma.priceList.findMany({
        where: {
          tenantId, ...activeEffective,
          OR: customerId ? [{ customerId: null }, { customerId }] : [{ customerId: null }],
        },
        select: { id: true, customerId: true },
      })
    ).sort((a, b) => (a.customerId ? -1 : 1) - (b.customerId ? -1 : 1)); // customer-specific first
    for (const list of candidateListIds) {
      const line = await this.prisma.priceListLine.findFirst({ where: { tenantId, priceListId: list.id, partId } });
      if (line) return { priceListId: list.id, customerSpecific: !!list.customerId, unitPrice: line.unitPrice, discountPercent: line.discountPercent };
    }
    return null;
  }
}
