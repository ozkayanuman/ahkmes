import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { LotAcceptanceStatus, Prisma, StockItemType } from "@prisma/client";
import type { CreateLotDto, DecideLotAcceptanceDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { writeTransactionalAudit } from "../common/transactional-audit";

@Injectable()
export class LotsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, itemType?: StockItemType, itemId?: string) {
    return this.prisma.lot.findMany({
      where: { tenantId, ...(itemType ? { itemType } : {}), ...(itemId ? { itemId } : {}) },
      orderBy: { receivedDate: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const lot = await this.prisma.lot.findFirst({ where: { id, tenantId } });
    if (!lot) throw new NotFoundException("Lot bulunamadı");
    return lot;
  }

  async create(tenantId: string, dto: CreateLotDto) {
    const exists =
      dto.itemType === "MATERIAL"
        ? await this.prisma.material.findFirst({ where: { id: dto.itemId, tenantId } })
        : await this.prisma.part.findFirst({ where: { id: dto.itemId, tenantId } });
    if (!exists) throw new NotFoundException(dto.itemType === "MATERIAL" ? "Malzeme bulunamadı" : "Parça bulunamadı");

    try {
      return await this.prisma.lot.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu lot numarası zaten kayıtlı");
      }
      throw e;
    }
  }

  async decideAcceptance(tenantId: string, userId: string, id: string, dto: DecideLotAcceptanceDto) {
    const lot = await this.findOne(tenantId, id);
    if (dto.status === "PENDING") throw new ConflictException("Kabul kararı PENDING olamaz");
    if (lot.acceptanceStatus === "ACCEPTED" || lot.acceptanceStatus === "REJECTED") {
      throw new ConflictException("Nihai kabul/red kararı değiştirilmez; düzeltme için yeni lot açın");
    }
    if (dto.status === "ACCEPTED" && lot.itemType === "MATERIAL") {
      const material = await this.prisma.material.findFirst({ where: { id: lot.itemId, tenantId } });
      if (!material) throw new NotFoundException("Lot malzemesi bulunamadı");
      if (material.certificateRequired && !lot.certificateNo) {
        throw new ConflictException("Bu malzeme için sertifika numarası olmadan kabul verilemez");
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.lot.update({
        where: { id: lot.id },
        data: { acceptanceStatus: dto.status as LotAcceptanceStatus, acceptanceNote: dto.note, acceptedById: userId, acceptedAt: new Date() },
      });
      await writeTransactionalAudit(tx, {
        tenantId,
        userId,
        entity: "lots",
        entityId: lot.id,
        action: "STATUS_CHANGE",
        before: lot,
        after: updated,
      });
      return updated;
    });
  }

  /**
   * Faz F: lot-bazlı forward/backward traceability. Granülarite iş emri düzeyinde
   * (bkz. work-orders.service.ts genealogy) — bir lot, MaterialConsumption/
   * FinishedGoodsEntry üzerinden bağlı olduğu WorkOrder(lar) aracılığıyla izlenir.
   * MATERIAL lot: forward = bu lottan tüketen WorkOrder'lar + onların ürettiği PART lot'lar.
   * PART lot: backward = bu lotu üreten WorkOrder + o WorkOrder'ın tükettiği MATERIAL lot'lar.
   * Not: Part'lar başka bir WorkOrder'a malzeme olarak girmiyor (BOM sadece Material
   * satırı destekliyor), bu yüzden zincir tek hop'ta doğal olarak sonlanır.
   */
  async trace(tenantId: string, id: string) {
    const lot = await this.findOne(tenantId, id);

    if (lot.itemType === "MATERIAL") {
      const consumptions = await this.prisma.materialConsumption.findMany({
        where: { tenantId, lotId: id },
        include: {
          workOrder: {
            select: {
              id: true,
              woNo: true,
              status: true,
              part: { select: { id: true, partNo: true, name: true } },
              finishedEntries: {
                where: { lotId: { not: null } },
                select: { id: true, quantity: true, date: true, lotId: true, lot: true },
              },
            },
          },
        },
      });
      return {
        lot,
        forward: {
          consumedByWorkOrders: consumptions.map((c) => ({
            consumption: { id: c.id, quantity: c.quantity, date: c.date },
            workOrder: c.workOrder,
            producedLots: c.workOrder.finishedEntries,
          })),
        },
      };
    }

    const finishedEntries = await this.prisma.finishedGoodsEntry.findMany({
      where: { tenantId, lotId: id },
      include: {
        workOrder: {
          select: {
            id: true,
            woNo: true,
            status: true,
            // Faz K: itemType/itemId polimorfik — Prisma tek bir "material" relation'ı
            // desteklemiyor, isim/kod çözümlemesi frontend'de yapılır (Alt-Faz B/C'de
            // bu trace() zaten recursive hale gelecek — bkz. PLAN.md Faz K notu).
            consumptions: {
              where: { lotId: { not: null } },
              include: { lot: true },
            },
          },
        },
      },
    });
    return {
      lot,
      backward: {
        producedByWorkOrders: finishedEntries.map((e) => ({
          entry: { id: e.id, quantity: e.quantity, date: e.date },
          workOrder: e.workOrder,
          consumedLots: e.workOrder.consumptions,
        })),
      },
    };
  }

  /** Barkod/QR tarama ile arama: fiziksel scanner çoğu zaman klavye girişi gibi
   * davranır ve tarih içeren lotNo'yu (id değil) gönderir — bu yüzden bir arama
   * girişi lazım. Bulunca aynı trace() zincirini döner (etiketten doğrudan
   * izlenebilirlik ekranına geçmek için). */
  async scanByCode(tenantId: string, lotNo: string) {
    const lot = await this.prisma.lot.findFirst({ where: { tenantId, lotNo } });
    if (!lot) throw new NotFoundException("Bu koda ait lot bulunamadı");
    return this.trace(tenantId, lot.id);
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    try {
      return await this.prisma.lot.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException("Lota bağlı stok bakiyesi var, silinemez");
      }
      throw e;
    }
  }
}
