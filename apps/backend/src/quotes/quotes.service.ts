import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { QuoteStatus } from "@prisma/client";
import type {
  ConvertQuoteDto,
  CreateQuoteDto,
  QuoteLineInputDto,
  UpdateQuoteDto,
  UpdateQuoteLineDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { nextDocNo } from "../common/numbering";
import { SalesOrdersService } from "../sales-orders/sales-orders.service";

// DRAFT → SENT → APPROVED | REJECTED; onaylanan/reddedilen teklif değişmez
const TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ["SENT"],
  SENT: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

const LINE_INCLUDE = {
  part: { select: { id: true, partNo: true, revision: true, name: true } },
  workOrders: { select: { id: true, woNo: true } },
  salesOrderLines: { select: { id: true, salesOrderId: true } },
} as const;

const QUOTE_INCLUDE = {
  customer: { select: { id: true, name: true } },
  lines: { include: LINE_INCLUDE, orderBy: { createdAt: "asc" as const } },
} as const;

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly salesOrders: SalesOrdersService,
  ) {}

  findAll(tenantId: string, status?: QuoteStatus, q?: string) {
    return this.prisma.quote.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { quoteNo: { contains: q, mode: "insensitive" as const } },
                { customer: { name: { contains: q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, tenantId },
      include: QUOTE_INCLUDE,
    });
    if (!quote) throw new NotFoundException("Teklif bulunamadı");
    return quote;
  }

  async create(tenantId: string, userId: string, dto: CreateQuoteDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId },
    });
    if (!customer) throw new NotFoundException("Müşteri bulunamadı");

    const created = await this.prisma.$transaction(async (tx) => {
      const quoteNo = await nextDocNo(tx, "quote", "quoteNo", "TKF");
      return tx.quote.create({
        data: {
          tenantId,
          quoteNo,
          customerId: dto.customerId,
          currency: dto.currency,
          validUntil: dto.validUntil,
          notes: dto.notes,
          createdById: userId,
          lines: {
            create: dto.lines.map((l) => ({
              tenantId,
              partId: l.partId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              dueDate: l.dueDate,
            })),
          },
        },
        include: QUOTE_INCLUDE,
      });
    });
    this.realtime.emitToTenant(tenantId, "quote.updated", { id: created.id });
    return created;
  }

  async update(tenantId: string, id: string, dto: UpdateQuoteDto) {
    const quote = await this.findOne(tenantId, id);
    this.ensureDraft(quote.status, "Teklif başlığı sadece taslakken düzenlenebilir");
    const updated = await this.prisma.quote.update({
      where: { id },
      data: dto,
      include: QUOTE_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "quote.updated", { id });
    return updated;
  }

  async setStatus(tenantId: string, id: string, status: QuoteStatus) {
    const quote = await this.findOne(tenantId, id);
    if (!TRANSITIONS[quote.status].includes(status)) {
      throw new ConflictException(`Geçersiz durum geçişi: ${quote.status} → ${status}`);
    }
    const updated = await this.prisma.quote.update({
      where: { id },
      data: { status },
      include: QUOTE_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "quote.updated", { id, status });
    return updated;
  }

  async remove(tenantId: string, id: string) {
    const quote = await this.findOne(tenantId, id);
    this.ensureDraft(quote.status, "Sadece taslak teklif silinebilir");
    const deleted = await this.prisma.quote.delete({ where: { id } });
    this.realtime.emitToTenant(tenantId, "quote.updated", { id, deleted: true });
    return deleted;
  }

  // ---- Satır işlemleri (sadece DRAFT) ----

  async addLine(tenantId: string, quoteId: string, dto: QuoteLineInputDto) {
    const quote = await this.findOne(tenantId, quoteId);
    this.ensureDraft(quote.status, "Satır sadece taslak teklife eklenebilir");
    const part = await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    await this.prisma.quoteLine.create({
      data: { tenantId, quoteId, ...dto },
    });
    this.realtime.emitToTenant(tenantId, "quote.updated", { id: quoteId });
    return this.findOne(tenantId, quoteId);
  }

  async updateLine(tenantId: string, quoteId: string, lineId: string, dto: UpdateQuoteLineDto) {
    const quote = await this.findOne(tenantId, quoteId);
    this.ensureDraft(quote.status, "Satır sadece taslak teklifte düzenlenebilir");
    const line = quote.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException("Teklif satırı bulunamadı");
    await this.prisma.quoteLine.update({ where: { id: lineId }, data: dto });
    this.realtime.emitToTenant(tenantId, "quote.updated", { id: quoteId });
    return this.findOne(tenantId, quoteId);
  }

  async removeLine(tenantId: string, quoteId: string, lineId: string) {
    const quote = await this.findOne(tenantId, quoteId);
    this.ensureDraft(quote.status, "Satır sadece taslak teklifte silinebilir");
    const line = quote.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException("Teklif satırı bulunamadı");
    if (quote.lines.length <= 1) {
      throw new ConflictException("Teklifte en az bir satır kalmalı");
    }
    await this.prisma.quoteLine.delete({ where: { id: lineId } });
    this.realtime.emitToTenant(tenantId, "quote.updated", { id: quoteId });
    return this.findOne(tenantId, quoteId);
  }

  // ---- Teklif → Satış Siparişi dönüşümü (Faz C) ----
  // Not: WorkOrder üretme mantığı artık burada değil — bkz.
  // SalesOrdersService.release() (SalesOrderLine'dan üretime alma, ayrı adım).

  async convert(tenantId: string, id: string, userId: string, dto: ConvertQuoteDto) {
    const quote = await this.findOne(tenantId, id);
    if (quote.status !== "APPROVED") {
      throw new ConflictException("Sadece onaylanmış (APPROVED) teklif satış siparişine dönüştürülebilir");
    }
    const targetLines = dto.lineIds?.length
      ? quote.lines.filter((l) => dto.lineIds!.includes(l.id))
      : quote.lines;
    if (dto.lineIds?.length && targetLines.length !== dto.lineIds.length) {
      throw new NotFoundException("Teklif satırı bulunamadı");
    }
    const convertible = targetLines.filter((l) => l.salesOrderLines.length === 0);
    if (convertible.length === 0) {
      throw new ConflictException("Seçilen satırlar zaten satış siparişine dönüştürülmüş");
    }

    const salesOrder = await this.salesOrders.createFromQuote(
      tenantId,
      userId,
      { id: quote.id, quoteNo: quote.quoteNo, customerId: quote.customerId, currency: quote.currency },
      convertible.map((l) => ({
        id: l.id,
        part: { id: l.part.id },
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        dueDate: l.dueDate,
      })),
    );

    this.realtime.emitToTenant(tenantId, "salesorder.updated", { id: salesOrder.id });
    return {
      salesOrder,
      skippedLineIds: targetLines.filter((l) => l.salesOrderLines.length > 0).map((l) => l.id),
    };
  }

  private ensureDraft(status: QuoteStatus, message: string) {
    if (status !== "DRAFT") throw new ConflictException(message);
  }
}
