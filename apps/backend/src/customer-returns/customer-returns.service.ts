import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { CustomerReturnStatus, InventoryMovementType, Prisma } from "@prisma/client";
import type { CancelCustomerReturnDto, CreateCustomerReturnDto, ReceiveCustomerReturnDto } from "@ahkmes/shared-types";
import { nextDocNo } from "../common/numbering";
import { writeTransactionalAudit } from "../common/transactional-audit";
import { InventoryService } from "../inventory/inventory.service";
import { OutboxService } from "../outbox/outbox.service";
import { PrismaService } from "../prisma/prisma.service";

const RETURN_INCLUDE = {
  delivery: { select: { id: true, dlvNo: true, deliveredAt: true } },
  lines: { include: { deliveryLine: { include: { salesOrderLine: { select: { partId: true, part: { select: { id: true, partNo: true } } } } } } } },
} as const;

@Injectable()
export class CustomerReturnsService {
  constructor(private readonly prisma: PrismaService, private readonly inventory: InventoryService, private readonly outbox: OutboxService) {}

  findAll(tenantId: string, filters: { deliveryId?: string; salesOrderId?: string } = {}) {
    return this.prisma.customerReturn.findMany({
      where: { tenantId, ...(filters.deliveryId ? { deliveryId: filters.deliveryId } : {}), ...(filters.salesOrderId ? { delivery: { salesOrderId: filters.salesOrderId } } : {}) },
      include: RETURN_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateCustomerReturnDto) {
    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findFirst({
        where: { id: dto.deliveryId, tenantId },
        include: { lines: { include: { salesOrderLine: { select: { partId: true } } } }, },
      });
      if (!delivery) throw new NotFoundException("Sevkiyat bulunamadı");
      if (!delivery.deliveredAt) throw new ConflictException("Teslim alması doğrulanmamış sevkiyat için müşteri iadesi açılamaz");
      if (await tx.customerReturn.findFirst({ where: { tenantId, deliveryId: delivery.id, status: { in: ["AUTHORIZED", "RECEIVED"] } } })) {
        throw new ConflictException("Bu sevkiyat için açık veya teslim alınmış bir müşteri iadesi zaten var");
      }
      const deliveryLines = new Map(delivery.lines.map((line) => [line.id, line]));
      const seen = new Set<string>();
      for (const line of dto.lines) {
        if (seen.has(line.deliveryLineId)) throw new ConflictException("Bir sevkiyat satırı RMA içinde yalnızca bir kez yer alabilir");
        seen.add(line.deliveryLineId);
        const shipped = deliveryLines.get(line.deliveryLineId);
        if (!shipped) throw new NotFoundException("İade satırı bu sevkiyata ait değil");
        if (line.qty > Number(shipped.qty) + 1e-9) throw new ConflictException("İade miktarı sevk edilen miktarı aşamaz");
      }
      const created = await tx.customerReturn.create({
        data: { tenantId, rmaNo: await nextDocNo(tx, "customerReturn", "rmaNo", "RMA"), deliveryId: delivery.id, reason: dto.reason, authorizedById: userId, lines: { create: dto.lines.map((line) => ({ tenantId, ...line })) } },
        include: RETURN_INCLUDE,
      });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "customer-returns", entityId: created.id, action: "CREATE", after: created });
      await this.outbox.record(tx, tenantId, "customer-return", created.id, "customerreturn.updated", { id: created.id, deliveryId: delivery.id, status: created.status });
      return created;
    });
  }

  async receive(tenantId: string, userId: string, id: string, dto: ReceiveCustomerReturnDto) {
    return this.prisma.$transaction(async (tx) => {
      const customerReturn = await tx.customerReturn.findFirst({ where: { id, tenantId }, include: RETURN_INCLUDE });
      if (!customerReturn) throw new NotFoundException("Müşteri iadesi bulunamadı");
      if (customerReturn.status !== CustomerReturnStatus.AUTHORIZED) throw new ConflictException("Yalnızca yetkilendirilmiş RMA fiziksel olarak kabul edilebilir");
      const warehouseName = "Sistem - Müşteri İade Karantinası";
      let warehouse = await tx.warehouse.findFirst({ where: { tenantId, name: warehouseName } });
      if (!warehouse) warehouse = await tx.warehouse.create({ data: { tenantId, name: warehouseName, code: "CUSTOMER-RETURNS" } });
      let quarantineBin = await tx.bin.findFirst({ where: { tenantId, warehouseId: warehouse.id, code: "QUARANTINE" } });
      if (!quarantineBin) quarantineBin = await tx.bin.create({ data: { tenantId, warehouseId: warehouse.id, code: "QUARANTINE", name: "İnceleme bekleyen müşteri iadeleri" } });
      for (const line of customerReturn.lines) {
        await this.inventory.record(tx, {
          tenantId, itemType: "PART", itemId: line.deliveryLine.salesOrderLine.partId, quantityDelta: Number(line.qty),
          movementType: InventoryMovementType.CUSTOMER_RETURN, sourceType: "CUSTOMER_RETURN", sourceId: customerReturn.id,
          sourceLineId: line.id, binId: quarantineBin.id, lotId: line.deliveryLine.lotId ?? undefined, createdById: userId,
          occurredAt: dto.receivedAt, note: `RMA ${customerReturn.rmaNo}: ${customerReturn.reason}`,
        });
      }
      const received = await tx.customerReturn.update({ where: { id }, data: { status: CustomerReturnStatus.RECEIVED, receivedById: userId, receivedAt: dto.receivedAt ?? new Date() }, include: RETURN_INCLUDE });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "customer-returns", entityId: id, action: "STATUS_CHANGE", before: { status: customerReturn.status }, after: { status: received.status, receivedAt: received.receivedAt, quarantineBinId: quarantineBin.id } });
      await this.outbox.record(tx, tenantId, "customer-return", id, "customerreturn.updated", { id, status: received.status });
      await this.outbox.record(tx, tenantId, "customer-return", id, "stock.updated", { reason: "customer-return", customerReturnId: id });
      return received;
    });
  }

  async cancel(tenantId: string, userId: string, id: string, dto: CancelCustomerReturnDto) {
    return this.prisma.$transaction(async (tx) => {
      const customerReturn = await tx.customerReturn.findFirst({ where: { id, tenantId } });
      if (!customerReturn) throw new NotFoundException("Müşteri iadesi bulunamadı");
      if (customerReturn.status !== CustomerReturnStatus.AUTHORIZED) throw new ConflictException("Yalnızca teslim alınmamış RMA iptal edilebilir");
      const cancelled = await tx.customerReturn.update({ where: { id }, data: { status: CustomerReturnStatus.CANCELLED }, include: RETURN_INCLUDE });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "customer-returns", entityId: id, action: "STATUS_CHANGE", before: { status: customerReturn.status }, after: { status: cancelled.status, reason: dto.reason } });
      await this.outbox.record(tx, tenantId, "customer-return", id, "customerreturn.updated", { id, status: cancelled.status });
      return cancelled;
    });
  }
}
