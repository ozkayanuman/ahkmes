import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SalesOrderStatus } from "@prisma/client";
import type { AssignSalesOrderFulfillmentPlantDto, ReleaseSalesOrderDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { nextDocNo } from "../common/numbering";
import { WorkOrdersService } from "../work-orders/work-orders.service";

// OPEN → CLOSED | CANCELLED; CLOSED/CANCELLED terminal
const TRANSITIONS: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  OPEN: ["CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

const LINE_INCLUDE = {
  part: { select: { id: true, partNo: true, revision: true, name: true } },
  fulfillmentPlant: { select: { id: true, name: true, code: true } },
  workOrders: { select: { id: true, woNo: true, status: true } },
} as const;

const SO_INCLUDE = {
  customer: { select: { id: true, name: true } },
  quote: { select: { id: true, quoteNo: true } },
  lines: { include: LINE_INCLUDE, orderBy: { createdAt: "asc" as const } },
} as const;

interface QuoteLineForConversion {
  id: string;
  part: { id: string };
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  dueDate: Date;
}

/** Faz C: Quote.convert() artık doğrudan WorkOrder değil SalesOrder üretir —
 * üretime alma (WorkOrder oluşturma) release() ile ayrı bir adımdır. */
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workOrders: WorkOrdersService,
    private readonly outbox: OutboxService,
  ) {}

  findAll(tenantId: string, status?: SalesOrderStatus, q?: string) {
    return this.prisma.salesOrder.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { soNo: { contains: q, mode: "insensitive" as const } },
                { customer: { name: { contains: q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: SO_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const so = await this.prisma.salesOrder.findFirst({ where: { id, tenantId }, include: SO_INCLUDE });
    if (!so) throw new NotFoundException("Satış siparişi bulunamadı");
    return so;
  }

  /** Onaylanmış bir Quote'un (seçilen ya da tüm) satırlarından SalesOrder
   * üretir — QuotesService.convert() tarafından çağrılır. */
  async createFromQuote(
    tenantId: string,
    userId: string,
    quote: { id: string; quoteNo: string; customerId: string; currency: string },
    lines: QuoteLineForConversion[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const soNo = await nextDocNo(tx, "salesOrder", "soNo", "SIP");
      const salesOrder = await tx.salesOrder.create({
        data: {
          tenantId,
          soNo,
          customerId: quote.customerId,
          quoteId: quote.id,
          currency: quote.currency,
          createdById: userId,
          notes: `${quote.quoteNo} teklifinden dönüştürüldü`,
          lines: {
            create: lines.map((l) => ({
              tenantId,
              quoteLineId: l.id,
              partId: l.part.id,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              dueDate: l.dueDate,
            })),
          },
        },
        include: SO_INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "salesorder", salesOrder.id, "salesorder.updated", { id: salesOrder.id });
      return salesOrder;
    });
  }

  async setStatus(tenantId: string, id: string, status: SalesOrderStatus) {
    const so = await this.findOne(tenantId, id);
    if (!TRANSITIONS[so.status].includes(status)) {
      throw new ConflictException(`Geçersiz durum geçişi: ${so.status} → ${status}`);
    }
    if (status === "CANCELLED" && so.lines.some((l) => Number(l.shippedQty) > 0)) {
      throw new ConflictException("Kısmen sevk edilmiş sipariş iptal edilemez");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.salesOrder.update({
        where: { id },
        data: { status },
        include: SO_INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "salesorder", id, "salesorder.updated", { id, status });
      return result;
    });
    return updated;
  }

  /**
   * Assigns the one explicit V1 planning/fulfillment plant owned by a sales
   * line. Assignment is idempotent but cannot be silently moved to a different
   * plant after it becomes plannable.
   */
  async assignFulfillmentPlant(
    tenantId: string,
    userId: string,
    salesOrderId: string,
    lineId: string,
    dto: AssignSalesOrderFulfillmentPlantDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const plant = await tx.plant.findFirst({ where: { id: dto.plantId, tenantId }, select: { id: true } });
      if (!plant) throw new NotFoundException("Plant was not found");
      await tx.$queryRaw`SELECT "id" FROM "SalesOrderLine" WHERE "id" = ${lineId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const line = await tx.salesOrderLine.findFirst({
        where: { id: lineId, tenantId, salesOrderId },
        include: { salesOrder: { select: { status: true } }, workOrders: { select: { id: true } } },
      });
      if (!line) throw new NotFoundException("Sales order line was not found");
      if (line.salesOrder.status !== "OPEN") throw new ConflictException("Only an OPEN sales order line can receive a fulfillment plant");
      if (line.workOrders.length) throw new ConflictException("A sales line with a work order can no longer change fulfillment provenance");
      if (line.fulfillmentPlantId === dto.plantId) return line;
      if (line.fulfillmentPlantId) throw new ConflictException("Sales order line fulfillment plant is already assigned");
      const updated = await tx.salesOrderLine.update({ where: { id: line.id }, data: { fulfillmentPlantId: dto.plantId } });
      await tx.auditLog.create({ data: { tenantId, userId, entity: "sales-order-line", entityId: line.id, action: "UPDATE", before: { fulfillmentPlantId: null, planningStatus: "NEEDS_PLANT_ASSIGNMENT" }, after: { fulfillmentPlantId: dto.plantId, planningStatus: "PLANNABLE" } } });
      await this.outbox.record(tx, tenantId, "salesorder", salesOrderId, "salesorder.updated", { id: salesOrderId, lineId, fulfillmentPlantId: dto.plantId });
      return updated;
    });
  }

  /** Seçilen (veya tüm) SalesOrderLine'ları üretime alır — her satırdan (henüz
   * WorkOrder'a dönüşmemişse) bir WorkOrder yaratır. Quote.convert()'in eski
   * WorkOrder-üretme mantığının SalesOrderLine'a taşınmış hali. */
  async release(tenantId: string, id: string, dto: ReleaseSalesOrderDto) {
    const so = await this.findOne(tenantId, id);
    if (so.status !== "OPEN") {
      throw new ConflictException("Sadece açık (OPEN) sipariş üretime alınabilir");
    }
    const targetLines = dto.lineIds?.length ? so.lines.filter((l) => dto.lineIds!.includes(l.id)) : so.lines;
    if (dto.lineIds?.length && targetLines.length !== dto.lineIds.length) {
      throw new NotFoundException("Sipariş satırı bulunamadı");
    }
    const releasable = targetLines.filter((l) => l.workOrders.length === 0);
    if (releasable.length === 0) {
      throw new ConflictException("Seçilen satırlar zaten üretime alınmış");
    }
    const unassigned = releasable.filter((line) => !line.fulfillmentPlantId);
    if (unassigned.length) throw new ConflictException("Sales order lines need an explicit fulfillment plant before production release");

    const workOrders = await this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const line of releasable) {
        const remainingQuantity = new Prisma.Decimal(line.quantity).sub(line.shippedQty);
        if (remainingQuantity.lte(0)) continue;
        const woNo = await nextDocNo(tx, "workOrder", "woNo", "IE");
        created.push(await this.workOrders.createWithRoute(tx, tenantId, {
          woNo,
          salesOrderLineId: line.id,
          partId: line.part.id,
          plantId: line.fulfillmentPlantId!,
          quantity: remainingQuantity,
          dueDate: line.dueDate,
        }));
      }
      await this.outbox.record(tx, tenantId, "salesorder", id, "workorder.updated", { ids: created.map((w) => w.id) });
      return created;
    });

    return {
      workOrders,
      skippedLineIds: targetLines.filter((l) => l.workOrders.length > 0).map((l) => l.id),
    };
  }
}
