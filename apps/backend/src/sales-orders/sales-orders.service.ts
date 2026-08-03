import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SalesOrderStatus } from "@prisma/client";
import type { ReleaseSalesOrderDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
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
    private readonly realtime: RealtimeGateway,
    private readonly workOrders: WorkOrdersService,
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
      return tx.salesOrder.create({
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
    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: { status },
      include: SO_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "salesorder.updated", { id, status });
    return updated;
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

    const workOrders = await this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const line of releasable) {
        const woNo = await nextDocNo(tx, "workOrder", "woNo", "IE");
        created.push(await this.workOrders.createWithRoute(tx, tenantId, {
          woNo,
          salesOrderLineId: line.id,
          partId: line.part.id,
          quantity: line.quantity,
          dueDate: line.dueDate,
        }));
      }
      return created;
    });

    this.realtime.emitToTenant(tenantId, "workorder.updated", { ids: workOrders.map((w) => w.id) });
    return {
      workOrders,
      skippedLineIds: targetLines.filter((l) => l.workOrders.length > 0).map((l) => l.id),
    };
  }
}
