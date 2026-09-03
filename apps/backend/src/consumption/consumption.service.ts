import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateConsumptionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
import { InventoryMovementType } from "@prisma/client";
import { OutboxService } from "../outbox/outbox.service";

const INCLUDE = {
  workOrder: { select: { id: true, woNo: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ConsumptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly outbox: OutboxService,
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
   * CONSUMED: immutable hareket/bakiye/toplam projeksiyonu aynı transaction'da
   * düşer; yetersiz stok 409. Faz K: itemType=PART ise alt montaj tüketimi —
   * aynı akış Material yerine Part + PartStock üzerinden çalışır
   * (InventoryService.record zaten polimorfik).
   */
  async create(tenantId: string, userId: string, dto: CreateConsumptionDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findFirst({ where: { id: dto.workOrderId, tenantId } });
      if (!wo) throw new NotFoundException("İş emri bulunamadı");
      if (wo.status === "COMPLETED" || wo.status === "CANCELLED") {
        throw new ConflictException("Tamamlanmış/iptal edilmiş iş emrine kayıt eklenemez");
      }
      if (wo.engineeringReleaseRequired) {
        throw new ConflictException("Released work orders must use the controlled production-material execution flow");
      }
      const lotTrackingRequired =
        dto.itemType === "MATERIAL"
          ? (await tx.material.findFirst({ where: { id: dto.itemId, tenantId } }))?.lotTrackingRequired
          : (await tx.part.findFirst({ where: { id: dto.itemId, tenantId } }))?.lotTrackingRequired;
      if (lotTrackingRequired === undefined) {
        throw new NotFoundException(dto.itemType === "MATERIAL" ? "Malzeme bulunamadı" : "Parça bulunamadı");
      }
      if (lotTrackingRequired && !dto.lotId) {
        throw new ConflictException(
          dto.itemType === "MATERIAL" ? "Bu malzeme için lot seçimi zorunludur" : "Bu parça için lot seçimi zorunludur",
        );
      }
      if (dto.lotId) {
        const lot = await tx.lot.findFirst({
          where: { id: dto.lotId, tenantId, itemType: dto.itemType, itemId: dto.itemId },
        });
        if (!lot) throw new NotFoundException("Lot bulunamadı veya bu kaleme ait değil");
        if (lot.acceptanceStatus !== "ACCEPTED") {
          throw new ConflictException("Sadece kabul edilmiş lot tüketilebilir");
        }
      }

      const entry = await tx.materialConsumption.create({
        data: {
          tenantId,
          workOrderId: dto.workOrderId,
          itemType: dto.itemType,
          itemId: dto.itemId,
          type: dto.type,
          quantity: dto.quantity,
          date: dto.date ?? new Date(),
          createdById: userId,
          lotId: dto.lotId,
        },
        include: INCLUDE,
      });
      if (dto.type === "CONSUMED") {
        const movement = await this.inventory.record(tx, {
          tenantId,
          itemType: dto.itemType,
          itemId: dto.itemId,
          quantityDelta: -dto.quantity,
          movementType: InventoryMovementType.CONSUMPTION,
          sourceType: "MATERIAL_CONSUMPTION",
          sourceId: entry.id,
          binId: dto.binId,
          lotId: dto.lotId,
          createdById: userId,
          occurredAt: dto.date ?? undefined,
        });
        const updated = await tx.materialConsumption.update({ where: { id: entry.id }, data: { binId: movement.binId }, include: INCLUDE });
        await this.outbox.record(tx, tenantId, "consumption", entry.id, "stock.updated", { itemType: dto.itemType, itemId: dto.itemId });
        await this.outbox.record(tx, tenantId, "consumption", entry.id, "workorder.updated", { id: dto.workOrderId });
        return updated;
      }
      await this.outbox.record(tx, tenantId, "consumption", entry.id, "workorder.updated", { id: dto.workOrderId });
      return entry;
    });

    return created;
  }

  /** Silme tüketimi geri alır: CONSUMED kayıtta stok iade edilir. */
  async remove(tenantId: string, userId: string, id: string) {
    const deleted = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.materialConsumption.findFirst({ where: { id, tenantId } });
      if (!entry) throw new NotFoundException("Tüketim kaydı bulunamadı");
      if (entry.type === "CONSUMED") {
        await this.inventory.record(tx, {
          tenantId,
          itemType: entry.itemType,
          itemId: entry.itemId,
          quantityDelta: Number(entry.quantity),
          movementType: InventoryMovementType.CONSUMPTION_REVERSAL,
          sourceType: "MATERIAL_CONSUMPTION_REVERSAL",
          sourceId: entry.id,
          binId: entry.binId ?? undefined,
          lotId: entry.lotId ?? undefined,
          createdById: userId,
        });
      }
      const removed = await tx.materialConsumption.delete({ where: { id } });
      await this.outbox.record(tx, tenantId, "consumption", id, "stock.updated", { itemType: removed.itemType, itemId: removed.itemId });
      return removed;
    });
    return deleted;
  }
}
