import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateCycleCountDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { nextDocNo } from "../common/numbering";
import { InventoryService } from "../inventory/inventory.service";
import { InventoryMovementType } from "@prisma/client";
import { writeTransactionalAudit } from "../common/transactional-audit";

const CC_INCLUDE = {
  bin: { select: { id: true, code: true, warehouse: { select: { id: true, name: true } } } },
  countedBy: { select: { id: true, name: true } },
  lines: true,
} as const;

/** Bin bazlı stok sayımı — OPEN'da sayılan miktarlar (systemQty snapshot +
 * countedQty + fark) kaydedilir, POSTED'da StockBalance sayılan miktara göre
 * SET edilir (increment/decrement değil — sayım mutlak doğrulama) ve geri
 * alınamaz (AuditLog/Delivery immutability felsefesiyle tutarlı). */
@Injectable()
export class CycleCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly inventory: InventoryService,
  ) {}

  findAll(tenantId: string, binId?: string) {
    return this.prisma.cycleCount.findMany({
      where: { tenantId, ...(binId ? { binId } : {}) },
      include: CC_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const cc = await this.prisma.cycleCount.findFirst({ where: { id, tenantId }, include: CC_INCLUDE });
    if (!cc) throw new NotFoundException("Sayım bulunamadı");
    return cc;
  }

  async create(tenantId: string, userId: string, dto: CreateCycleCountDto) {
    const bin = await this.prisma.bin.findFirst({ where: { id: dto.binId, tenantId } });
    if (!bin) throw new NotFoundException("Raf (bin) bulunamadı");

    const created = await this.prisma.$transaction(async (tx) => {
      const linesData = [];
      for (const l of dto.lines) {
        const balance = await tx.stockBalance.findFirst({
          where: { tenantId, binId: dto.binId, itemType: l.itemType, itemId: l.itemId, lotId: l.lotId ?? null },
        });
        const systemQty = balance ? Number(balance.qty) : 0;
        linesData.push({
          tenantId,
          itemType: l.itemType,
          itemId: l.itemId,
          lotId: l.lotId,
          systemQty,
          countedQty: l.countedQty,
          varianceQty: l.countedQty - systemQty,
        });
      }

      const ccNo = await nextDocNo(tx, "cycleCount", "ccNo", "SAY");
      const cycleCount = await tx.cycleCount.create({
        data: {
          tenantId,
          ccNo,
          binId: dto.binId,
          countedById: userId,
          lines: { create: linesData },
        },
        include: CC_INCLUDE,
      });

      await writeTransactionalAudit(tx, {
        tenantId,
        userId,
        entity: "cycle-counts",
        entityId: cycleCount.id,
        action: "CREATE",
        after: cycleCount,
      });

      return cycleCount;
    });

    this.realtime.emitToTenant(tenantId, "cyclecount.created", { id: created.id, binId: dto.binId });
    return created;
  }

  async post(tenantId: string, userId: string, id: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      // Taze veriyle: bkz. delivery/invoice.service.ts aynı deseni kullanır.
      const cc = await tx.cycleCount.findFirst({ where: { id, tenantId }, include: { lines: true } });
      if (!cc) throw new NotFoundException("Sayım bulunamadı");
      if (cc.status !== "OPEN") {
        throw new ConflictException("Sadece açık (OPEN) sayım postalanabilir");
      }

      for (const line of cc.lines) {
        const balance = await tx.stockBalance.findFirst({
          where: { tenantId, binId: cc.binId, itemType: line.itemType, itemId: line.itemId, lotId: line.lotId },
        });
        const delta = Number(line.countedQty) - Number(balance?.qty ?? 0);
        if (delta !== 0) {
          await this.inventory.record(tx, {
            tenantId,
            itemType: line.itemType,
            itemId: line.itemId,
            quantityDelta: delta,
            movementType: InventoryMovementType.CYCLE_COUNT_ADJUSTMENT,
            sourceType: "CYCLE_COUNT",
            sourceId: cc.id,
            sourceLineId: line.id,
            binId: cc.binId,
            lotId: line.lotId ?? undefined,
            createdById: userId,
            note: `Sayım düzeltmesi: ${Number(balance?.qty ?? 0)} → ${Number(line.countedQty)}`,
          });
        }
      }

      const posted = await tx.cycleCount.update({
        where: { id },
        data: { status: "POSTED", postedAt: new Date() },
        include: CC_INCLUDE,
      });

      await writeTransactionalAudit(tx, {
        tenantId,
        userId,
        entity: "cycle-counts",
        entityId: cc.id,
        action: "STATUS_CHANGE",
        before: { status: cc.status, postedAt: cc.postedAt },
        after: { status: posted.status, postedAt: posted.postedAt },
      });

      return posted;
    });

    this.realtime.emitToTenant(tenantId, "cyclecount.updated", { id, status: "POSTED" });
    this.realtime.emitToTenant(tenantId, "stock.updated", { reason: "cyclecount", cycleCountId: id });
    return updated;
  }
}
