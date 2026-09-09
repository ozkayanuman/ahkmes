import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Lot, LotAcceptanceStatus, Prisma, StockItemType } from "@prisma/client";
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
   * MATERIAL lot: forward = bu lottan tüketen WorkOrder'lar + onların ürettiği PART lot'lar
   * (üretilen PART lotu da başka bir üst montaja tüketildiyse forward zinciri devam eder).
   * PART lot: backward = bu lotu üreten WorkOrder + tükettiği MATERIAL/PART lot'lar (Faz K
   * 2b'den beri alt montajlar da tüketilebiliyor, tüketilen bir PART lotu kendi backward
   * zincirini taşır) — Faz K 3: artık çok seviyeli, PART lotu ayrıca kendi forward zincirini
   * de taşır (bir üst montaja daha girmiş olabilir). Döngü/aşırı derinlik MRP'deki
   * MAX_BOM_DEPTH deseniyle aynı şekilde `MAX_TRACE_DEPTH` + ziyaret edilen lot seti ile
   * sınırlanır.
   */
  async trace(tenantId: string, id: string) {
    const lot = await this.findOne(tenantId, id);

    if (lot.itemType === "MATERIAL") {
      return { lot, forward: await this.traceForward(tenantId, lot, 0, new Set([lot.id])) };
    }

    const [backward, forward] = await Promise.all([
      this.traceBackward(tenantId, lot, 0, new Set([lot.id])),
      this.traceForward(tenantId, lot, 0, new Set([lot.id])),
    ]);
    return { lot, backward, forward };
  }

  private static readonly MAX_TRACE_DEPTH = 10;

  /** Bu lotu tüketen WorkOrder(lar) + onların ürettiği lot(lar) — üretilen lot varsa
   * kendi forward zincirine recursive iner (bir üst montaja daha girmiş olabilir). */
  private async traceForward(
    tenantId: string,
    lot: Lot,
    depth: number,
    visited: Set<string>,
  ): Promise<{ consumedByWorkOrders: unknown[] }> {
    if (depth >= LotsService.MAX_TRACE_DEPTH) return { consumedByWorkOrders: [] };

    const consumptions = await this.prisma.materialConsumption.findMany({
      where: { tenantId, lotId: lot.id },
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

    const consumedByWorkOrders = await Promise.all(
      consumptions.map(async (c) => ({
        consumption: { id: c.id, quantity: c.quantity, date: c.date },
        workOrder: c.workOrder,
        producedLots: await Promise.all(
          c.workOrder.finishedEntries.map(async (entry) => ({
            ...entry,
            forward:
              entry.lot && !visited.has(entry.lot.id)
                ? await this.traceForward(tenantId, entry.lot, depth + 1, new Set(visited).add(entry.lot.id))
                : null,
          })),
        ),
      })),
    );
    return { consumedByWorkOrders };
  }

  /** Bu lotu üreten WorkOrder + tükettiği lot(lar) — tüketilen bir PART lotu varsa
   * kendi backward zincirine recursive iner (kendisi de bir alt montajdan üretilmiş olabilir). */
  private async traceBackward(
    tenantId: string,
    lot: Lot,
    depth: number,
    visited: Set<string>,
  ): Promise<{ producedByWorkOrders: unknown[] }> {
    if (depth >= LotsService.MAX_TRACE_DEPTH) return { producedByWorkOrders: [] };

    const finishedEntries = await this.prisma.finishedGoodsEntry.findMany({
      where: { tenantId, lotId: lot.id },
      include: {
        workOrder: {
          select: {
            id: true,
            woNo: true,
            status: true,
            consumptions: {
              where: { lotId: { not: null } },
              include: { lot: true },
            },
          },
        },
      },
    });

    const producedByWorkOrders = await Promise.all(
      finishedEntries.map(async (e) => ({
        entry: { id: e.id, quantity: e.quantity, date: e.date },
        workOrder: { id: e.workOrder.id, woNo: e.workOrder.woNo, status: e.workOrder.status },
        consumedLots: await Promise.all(
          e.workOrder.consumptions.map(async (c) => ({
            ...c,
            backward:
              c.lot && c.lot.itemType === "PART" && !visited.has(c.lot.id)
                ? await this.traceBackward(tenantId, c.lot, depth + 1, new Set(visited).add(c.lot.id))
                : null,
          })),
        ),
      })),
    );
    return { producedByWorkOrders };
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
