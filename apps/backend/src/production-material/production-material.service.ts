import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InventoryMovementType, Prisma, ProductionMaterialRequirementStatus, ProductionMaterialTransactionType } from "@prisma/client";
import type { CreateProductionMaterialReservationDto, ProductionMaterialMutationDto } from "@ahkmes/shared-types";
import { InventoryService } from "../inventory/inventory.service";
import { OutboxService } from "../outbox/outbox.service";
import { PrismaService } from "../prisma/prisma.service";
import { writeTransactionalAudit } from "../common/transactional-audit";

const ACTIVE = ["OPEN", "PARTIALLY_ALLOCATED", "ALLOCATED", "PARTIALLY_ISSUED", "ISSUED"] as ProductionMaterialRequirementStatus[];
@Injectable()
export class ProductionMaterialService {
  constructor(private readonly prisma: PrismaService, private readonly inventory: InventoryService, private readonly outbox: OutboxService) {}
  async requirements(tenantId: string, workOrderId: string) {
    const requirements = await this.prisma.productionMaterialRequirement.findMany({
      where: { tenantId, workOrderId },
      include: { reservations: { where: { status: { in: ACTIVE } }, include: { bin: true, lot: true } }, transactions: true },
      orderBy: { createdAt: "asc" },
    });
    const materialIds = requirements.filter((requirement) => requirement.itemType === "MATERIAL").map((requirement) => requirement.itemId);
    const partIds = requirements.filter((requirement) => requirement.itemType === "PART").map((requirement) => requirement.itemId);
    const [materials, parts] = await Promise.all([
      materialIds.length ? this.prisma.material.findMany({ where: { tenantId, id: { in: materialIds } }, select: { id: true, code: true, name: true, unit: true, lotTrackingRequired: true } }) : [],
      partIds.length ? this.prisma.part.findMany({ where: { tenantId, id: { in: partIds } }, select: { id: true, partNo: true, name: true, unit: true } }) : [],
    ]);
    const materialById = new Map(materials.map((material) => [material.id, material]));
    const partById = new Map(parts.map((part) => [part.id, part]));
    return requirements.map((requirement) => ({
      ...requirement,
      item: requirement.itemType === "MATERIAL" ? materialById.get(requirement.itemId) ?? null : partById.get(requirement.itemId) ?? null,
    }));
  }
  async availability(tenantId: string, itemId: string, binId?: string, lotId?: string) {
    const balances = await this.prisma.stockBalance.findMany({ where: { tenantId, itemId, ...(binId ? { binId } : {}), ...(lotId ? { lotId } : {}) } });
    const [reservations, maintenanceReservations] = await Promise.all([
      this.prisma.productionMaterialReservation.findMany({ where: { tenantId, status: { in: ACTIVE }, ...(binId ? { binId } : {}), ...(lotId ? { lotId } : {}), requirement: { itemId } }, select: { quantity: true, issuedQty: true } }),
      this.prisma.maintenanceSpareReservation.findMany({ where: { tenantId, status: { in: ["OPEN", "PARTIALLY_ISSUED"] }, ...(binId ? { binId } : {}), ...(lotId ? { lotId } : {}), spareLine: { itemId } }, select: { quantity: true, issuedQty: true } }),
    ]);
    const held = lotId ? await this.prisma.qualityHold.aggregate({ where: { tenantId, lotId, status: "ACTIVE" }, _sum: { quantity: true } }) : null;
    const onHand = balances.reduce((sum, row) => sum.plus(row.qty), new Prisma.Decimal(0)); const allocated = [...reservations, ...maintenanceReservations].reduce((sum, row) => sum.plus(row.quantity).minus(row.issuedQty), new Prisma.Decimal(0));
    const qualityHeld = new Prisma.Decimal(held?._sum.quantity ?? 0);
    return { onHand: onHand.toString(), reserved: allocated.toString(), qualityHeld: qualityHeld.toString(), available: onHand.minus(allocated).minus(qualityHeld).toString() };
  }
  async reserve(tenantId: string, userId: string, dto: CreateProductionMaterialReservationDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.productionMaterialReservation.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (existing) return existing;
      const requirement = await tx.productionMaterialRequirement.findFirst({ where: { id: dto.requirementId, tenantId } }); if (!requirement || requirement.status === "CANCELLED" || requirement.status === "CLOSED") throw new NotFoundException("Production material requirement was not found");
      const material = requirement.itemType === "MATERIAL"
        ? await tx.material.findFirst({ where: { id: requirement.itemId, tenantId } })
        : null;
      if (requirement.itemType === "MATERIAL" && !material) throw new NotFoundException("Material was not found");
      if (material?.lotTrackingRequired && !dto.lotId) throw new ConflictException("Lot-tracked material requires a lot selection");
      const serialIds = dto.materialSerialIds ?? [];
      if (material?.serialTrackingRequired) {
        if (!serialIds.length || !Number.isInteger(dto.quantity) || serialIds.length !== dto.quantity || new Set(serialIds).size !== serialIds.length) {
          throw new ConflictException("Serial-tracked material requires one unique serial for each whole-unit reservation");
        }
        const serials = await tx.materialSerialNumber.findMany({ where: { tenantId, id: { in: serialIds }, materialId: requirement.itemId, status: "AVAILABLE", reservationId: null } });
        if (serials.length !== serialIds.length || serials.some((serial) => (dto.lotId ? serial.lotId !== dto.lotId : serial.lotId !== null))) throw new ConflictException("Selected material serials are unavailable or do not match the reservation lot");
      } else if (serialIds.length) throw new ConflictException("Material serials cannot be allocated when serial tracking is disabled");
      if (dto.lotId) {
        const lot = await tx.lot.findFirst({
          where: { id: dto.lotId, tenantId, itemType: requirement.itemType, itemId: requirement.itemId },
        });
        if (!lot) throw new NotFoundException("Selected lot was not found for material");
      }
      // Serialise all allocations competing for the same physical balance. The
      // following aggregate runs while this PostgreSQL row lock is held.
      await tx.$queryRaw`SELECT "id" FROM "StockBalance" WHERE "tenantId" = ${tenantId} AND "binId" = ${dto.binId} AND "itemType" = ${requirement.itemType}::"StockItemType" AND "itemId" = ${requirement.itemId} AND "lotId" IS NOT DISTINCT FROM ${dto.lotId ?? null} FOR UPDATE`;
      const balance = await tx.stockBalance.findFirst({ where: { tenantId, binId: dto.binId, itemType: requirement.itemType, itemId: requirement.itemId, lotId: dto.lotId ?? null } });
      if (!balance) throw new ConflictException("Selected stock balance was not found");
      if (dto.lotId && await tx.qualityHold.findFirst({ where: { tenantId, lotId: dto.lotId, status: "ACTIVE" } })) throw new ConflictException("Selected inventory lot is on quality hold");
      const [competing, maintenanceCompeting] = await Promise.all([
        tx.productionMaterialReservation.findMany({ where: { tenantId, binId: dto.binId, lotId: dto.lotId ?? null, status: { in: ACTIVE }, requirement: { itemType: requirement.itemType, itemId: requirement.itemId } }, select: { quantity: true, issuedQty: true } }),
        tx.maintenanceSpareReservation.findMany({ where: { tenantId, binId: dto.binId, lotId: dto.lotId ?? null, status: { in: ["OPEN", "PARTIALLY_ISSUED"] }, spareLine: { itemType: requirement.itemType, itemId: requirement.itemId } }, select: { quantity: true, issuedQty: true } }),
      ]);
      const activeAllocated = [...competing, ...maintenanceCompeting].reduce((sum, row) => sum.plus(row.quantity).minus(row.issuedQty), new Prisma.Decimal(0));
      const remainingNeed = new Prisma.Decimal(requirement.requiredQty).minus(requirement.reservedQty).minus(requirement.issuedQty); const available = new Prisma.Decimal(balance.qty).minus(activeAllocated);
      if (new Prisma.Decimal(dto.quantity).gt(remainingNeed) || new Prisma.Decimal(dto.quantity).gt(available)) throw new ConflictException("Insufficient available stock or requirement already allocated");
      const reservation = await tx.productionMaterialReservation.create({ data: { tenantId, requirementId: requirement.id, binId: dto.binId, lotId: dto.lotId, quantity: dto.quantity, idempotencyKey: dto.idempotencyKey, createdById: userId } });
      if (serialIds.length) {
        const assigned = await tx.materialSerialNumber.updateMany({ where: { tenantId, id: { in: serialIds }, materialId: requirement.itemId, status: "AVAILABLE", reservationId: null }, data: { status: "RESERVED", reservationId: reservation.id } });
        if (assigned.count !== serialIds.length) throw new ConflictException("One or more material serials were allocated concurrently");
      }
      const total = new Prisma.Decimal(requirement.reservedQty).plus(dto.quantity); await tx.productionMaterialRequirement.update({ where: { id: requirement.id }, data: { reservedQty: total, status: total.gte(requirement.requiredQty) ? "ALLOCATED" : "PARTIALLY_ALLOCATED" } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "production-material-reservation", entityId: reservation.id, action: "CREATE", after: { requirementId: requirement.id, binId: dto.binId, lotId: dto.lotId, quantity: dto.quantity, materialSerialIds: serialIds } });
      await this.outbox.record(tx, tenantId, "production-material-requirement", requirement.id, "workorder.updated", { id: requirement.workOrderId }); return reservation;
    });
  }
  async cancelReservation(tenantId: string, userId: string, reservationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.productionMaterialReservation.findFirst({ where: { id: reservationId, tenantId }, include: { requirement: true } });
      if (!reservation) throw new NotFoundException("Production material reservation was not found");
      if (reservation.status === "CANCELLED") return reservation;
      if (new Prisma.Decimal(reservation.issuedQty).gt(0)) throw new ConflictException("Issued reservations cannot be cancelled; return unconsumed material first");
      if (reservation.requirement.itemType === "MATERIAL") {
        const material = await tx.material.findFirst({ where: { id: reservation.requirement.itemId, tenantId } });
        if (!material) throw new NotFoundException("Material was not found");
        if (material.serialTrackingRequired) {
          await tx.materialSerialNumber.updateMany({ where: { tenantId, reservationId: reservation.id, status: "RESERVED" }, data: { status: "AVAILABLE", reservationId: null } });
        }
      }
      const cancelled = await tx.productionMaterialReservation.update({ where: { id: reservation.id }, data: { status: "CANCELLED" } });
      const candidate = new Prisma.Decimal(reservation.requirement.reservedQty).minus(reservation.quantity);
      const remaining = Prisma.Decimal.max(candidate, new Prisma.Decimal(0));
      await tx.productionMaterialRequirement.update({ where: { id: reservation.requirementId }, data: { reservedQty: remaining, status: remaining.isZero() ? "OPEN" : "PARTIALLY_ALLOCATED" } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "production-material-reservation", entityId: reservation.id, action: "STATUS_CHANGE", before: { status: reservation.status }, after: { status: "CANCELLED" } });
      await this.outbox.record(tx, tenantId, "production-material-requirement", reservation.requirementId, "workorder.updated", { id: reservation.requirement.workOrderId });
      return cancelled;
    });
  }
  async backflush(tenantId: string, userId: string, workOrderId: string, operationId: string, goodQty: number, scrapQty: number, keyPrefix: string, client?: Prisma.TransactionClient) {
    const run = async (tx: Prisma.TransactionClient) => {
      const wo = await tx.workOrder.findFirst({ where: { id: workOrderId, tenantId } }); if (!wo) throw new NotFoundException("Work order was not found");
      const requirements = await tx.productionMaterialRequirement.findMany({ where: { tenantId, workOrderId, issueMethod: "BACKFLUSH", OR: [{ operationId }, { operationId: null }] } });
      const events = [];
      for (const req of requirements) {
        const counted = req.consumeOnScrap ? goodQty + scrapQty : goodQty;
        const runTotals = await tx.productionRun.aggregate({ where: { tenantId, workOrderId, ...(operationId ? { operationId } : {}) }, _sum: { goodCount: true, scrapCount: true } });
        const cumulativeProcessed = req.consumeOnScrap ? (runTotals._sum.goodCount ?? 0) + (runTotals._sum.scrapCount ?? 0) : (runTotals._sum.goodCount ?? 0);
        const expected = new Prisma.Decimal(req.requiredQty).mul(cumulativeProcessed).div(wo.quantity);
        const already = await tx.productionMaterialTransaction.aggregate({ where: { tenantId, requirementId: req.id, type: "BACKFLUSH" }, _sum: { quantity: true } });
        const delta = expected.minus(already._sum.quantity ?? 0); if (delta.lte(0)) continue;
        const wip = new Prisma.Decimal(req.issuedQty).minus(req.consumedQty).minus(req.returnedQty).minus(req.scrappedQty);
        if (delta.gt(wip)) throw new ConflictException("Backflush requires sufficient issued production material");
        const idempotencyKey = `${keyPrefix}:backflush:${req.id}:${expected.toString()}`;
        const existing = await tx.productionMaterialTransaction.findFirst({ where: { tenantId, idempotencyKey } }); if (existing) { events.push(existing); continue; }
        const event = await tx.productionMaterialTransaction.create({ data: { tenantId, requirementId: req.id, type: "BACKFLUSH", quantity: delta, idempotencyKey, createdById: userId } });
        await tx.productionMaterialRequirement.update({ where: { id: req.id }, data: { consumedQty: { increment: delta } } }); events.push(event);
      }
      return events;
    };
    return client ? run(client) : this.prisma.$transaction(run);
  }
  async execute(tenantId: string, userId: string, type: "issue"|"consume"|"return"|"scrap", dto: ProductionMaterialMutationDto) {
    if (!["issue", "consume", "return", "scrap"].includes(type)) throw new BadRequestException("Unsupported production material transaction");
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.productionMaterialTransaction.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (previous) return previous;
      const req = await tx.productionMaterialRequirement.findFirst({ where: { id: dto.requirementId, tenantId } }); if (!req) throw new NotFoundException("Production material requirement was not found");
      const qty = new Prisma.Decimal(dto.quantity); const wip = new Prisma.Decimal(req.issuedQty).minus(req.consumedQty).minus(req.returnedQty).minus(req.scrappedQty);
      let res: Awaited<ReturnType<typeof tx.productionMaterialReservation.findFirst>> = null;
      if (type === "issue") {
        if (!dto.reservationId) throw new ConflictException("Issue requires a reservation");
        res = await tx.productionMaterialReservation.findFirst({ where: { id: dto.reservationId, tenantId, requirementId: req.id, status: { in: ACTIVE } } });
        if (!res || qty.gt(new Prisma.Decimal(res.quantity).minus(res.issuedQty))) throw new ConflictException("Issue exceeds active reservation");
        if (dto.lotId && dto.lotId !== res.lotId) throw new ConflictException("Issue lot does not match reservation");
        if (req.itemType === "MATERIAL") {
          const material = await tx.material.findFirst({ where: { id: req.itemId, tenantId } });
          if (!material) throw new NotFoundException("Material was not found");
          if (material.lotTrackingRequired && !res.lotId) throw new ConflictException("Lot-tracked material requires a lot-resolved reservation");
          if (material.serialTrackingRequired) {
            const serialIds = dto.materialSerialIds ?? [];
            if (!serialIds.length || !Number.isInteger(Number(qty)) || serialIds.length !== Number(qty) || new Set(serialIds).size !== serialIds.length) throw new ConflictException("Serial-tracked issue requires one unique reserved serial for each whole unit");
            const serials = await tx.materialSerialNumber.findMany({ where: { tenantId, id: { in: serialIds }, materialId: req.itemId, lotId: res.lotId, reservationId: res.id, status: "RESERVED" } });
            if (serials.length !== serialIds.length) throw new ConflictException("Selected material serials are not reserved for this issue");
            const issued = await tx.materialSerialNumber.updateMany({ where: { tenantId, id: { in: serialIds }, reservationId: res.id, status: "RESERVED" }, data: { status: "ISSUED" } });
            if (issued.count !== serialIds.length) throw new ConflictException("One or more material serials were issued concurrently");
          }
        }
        await this.inventory.record(tx, { tenantId, itemType: req.itemType, itemId: req.itemId, quantityDelta: -Number(qty), movementType: InventoryMovementType.PRODUCTION_ISSUE, sourceType: "PRODUCTION_MATERIAL", sourceId: req.id, sourceLineId: res.id, binId: res.binId, lotId: res.lotId ?? undefined, createdById: userId });
        await tx.productionMaterialReservation.update({ where: { id: res.id }, data: { issuedQty: { increment: qty }, status: new Prisma.Decimal(res.issuedQty).plus(qty).gte(res.quantity) ? "ISSUED" : "PARTIALLY_ISSUED" } });
      }
      else if (qty.gt(wip)) throw new ConflictException("Transaction exceeds issued production WIP");
      if ((type === "consume" || type === "scrap") && req.itemType === "MATERIAL") {
        const material = await tx.material.findFirst({ where: { id: req.itemId, tenantId } });
        if (!material) throw new NotFoundException("Material was not found");
        if (material.serialTrackingRequired) {
          const serialIds = dto.materialSerialIds ?? [];
          if (!serialIds.length || !Number.isInteger(Number(qty)) || serialIds.length !== Number(qty) || new Set(serialIds).size !== serialIds.length) throw new ConflictException("Serial-tracked transaction requires one unique issued serial for each whole unit");
          const serials = await tx.materialSerialNumber.findMany({ where: { tenantId, id: { in: serialIds }, materialId: req.itemId, status: "ISSUED" } });
          if (serials.length !== serialIds.length) throw new ConflictException("Selected material serials are not currently issued");
          const updated = await tx.materialSerialNumber.updateMany({ where: { tenantId, id: { in: serialIds }, materialId: req.itemId, status: "ISSUED" }, data: { status: type === "consume" ? "CONSUMED" : "SCRAPPED" } });
          if (updated.count !== serialIds.length) throw new ConflictException("One or more material serials changed concurrently");
        }
      }
      if (type === "return" && req.itemType === "MATERIAL") {
        const material = await tx.material.findFirst({ where: { id: req.itemId, tenantId } });
        if (!material) throw new NotFoundException("Material was not found");
        if (material.serialTrackingRequired) {
          const serialIds = dto.materialSerialIds ?? [];
          if (!serialIds.length || !Number.isInteger(Number(qty)) || serialIds.length !== Number(qty) || new Set(serialIds).size !== serialIds.length) throw new ConflictException("Serial-tracked return requires one unique issued serial for each whole unit");
          const serials = await tx.materialSerialNumber.findMany({ where: { tenantId, id: { in: serialIds }, materialId: req.itemId, status: "ISSUED" } });
          if (serials.length !== serialIds.length) throw new ConflictException("Selected material serials are not currently issued");
          const updated = await tx.materialSerialNumber.updateMany({ where: { tenantId, id: { in: serialIds }, materialId: req.itemId, status: "ISSUED" }, data: { status: "RETURNED", reservationId: null } });
          if (updated.count !== serialIds.length) throw new ConflictException("One or more material serials changed concurrently");
        }
      }
      if (type === "return") await this.inventory.record(tx, { tenantId, itemType: req.itemType, itemId: req.itemId, quantityDelta: Number(qty), movementType: InventoryMovementType.PRODUCTION_RETURN, sourceType: "PRODUCTION_MATERIAL", sourceId: req.id, binId: dto.binId, lotId: dto.lotId, createdById: userId });
      const txType: ProductionMaterialTransactionType = type === "issue" ? "ISSUE" : type === "consume" ? "CONSUME" : type === "return" ? "RETURN" : "SCRAP";
      const event = await tx.productionMaterialTransaction.create({ data: { tenantId, requirementId: req.id, reservationId: dto.reservationId, type: txType, quantity: qty, binId: dto.binId ?? (type === "issue" ? res?.binId : undefined), lotId: type === "issue" ? res?.lotId : dto.lotId, reasonCode: dto.reasonCode, idempotencyKey: dto.idempotencyKey, createdById: userId } });
      const data = type === "issue" ? { issuedQty: { increment: qty }, reservedQty: { decrement: qty }, status: "PARTIALLY_ISSUED" as const } : type === "consume" ? { consumedQty: { increment: qty } } : type === "return" ? { returnedQty: { increment: qty } } : { scrappedQty: { increment: qty } };
      await tx.productionMaterialRequirement.update({ where: { id: req.id }, data });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "production-material-transaction", entityId: event.id, action: "CREATE", after: { requirementId: req.id, type: txType, quantity: qty.toString(), binId: event.binId, lotId: event.lotId, reasonCode: event.reasonCode } });
      await this.outbox.record(tx, tenantId, "production-material", event.id, "stock.updated", { itemId: req.itemId }); return event;
    });
  }
}
