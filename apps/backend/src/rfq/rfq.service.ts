import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { RFQStatus } from "@prisma/client";
import type {
  ConvertRfqDto,
  CreateRfqDto,
  RfqLineInputDto,
  UpdateRfqDto,
  UpdateRfqLineDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { nextDocNo } from "../common/numbering";

// DRAFT → SENT → CLOSED; CONVERTED sadece convert() ile set edilir (setStatus'tan erişilemez)
const TRANSITIONS: Record<RFQStatus, RFQStatus[]> = {
  DRAFT: ["SENT"],
  SENT: ["CLOSED"],
  CONVERTED: [],
  CLOSED: [],
};

const LINE_INCLUDE = {
  part: { select: { id: true, partNo: true, revision: true, name: true } },
} as const;

const RFQ_INCLUDE = {
  customer: { select: { id: true, name: true } },
  lines: { include: LINE_INCLUDE, orderBy: { createdAt: "asc" as const } },
} as const;

/** Müşteri teklif talebi (RFQ) — Quote'un öncesi, fiyatsız. Faz C: Quote akışından
 * ayna alınmıştır (TRANSITIONS/convert deseni bkz. quotes.service.ts). */
@Injectable()
export class RfqService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  findAll(tenantId: string, status?: RFQStatus, q?: string) {
    return this.prisma.rFQ.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { rfqNo: { contains: q, mode: "insensitive" as const } },
                { customer: { name: { contains: q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: RFQ_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const rfq = await this.prisma.rFQ.findFirst({ where: { id, tenantId }, include: RFQ_INCLUDE });
    if (!rfq) throw new NotFoundException("Teklif talebi bulunamadı");
    return rfq;
  }

  async create(tenantId: string, userId: string, dto: CreateRfqDto) {
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } });
    if (!customer) throw new NotFoundException("Müşteri bulunamadı");

    const created = await this.prisma.$transaction(async (tx) => {
      const rfqNo = await nextDocNo(tx, "rFQ", "rfqNo", "TAL");
      const rfq = await tx.rFQ.create({
        data: {
          tenantId,
          rfqNo,
          customerId: dto.customerId,
          validUntil: dto.validUntil,
          notes: dto.notes,
          createdById: userId,
          lines: {
            create: dto.lines.map((l) => ({
              tenantId,
              partId: l.partId,
              quantity: l.quantity,
              dueDate: l.dueDate,
            })),
          },
        },
        include: RFQ_INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "rfq", rfq.id, "rfq.updated", { id: rfq.id });
      return rfq;
    });
    return created;
  }

  async update(tenantId: string, id: string, dto: UpdateRfqDto) {
    const rfq = await this.findOne(tenantId, id);
    this.ensureDraft(rfq.status, "Teklif talebi başlığı sadece taslakken düzenlenebilir");
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.rFQ.update({ where: { id }, data: dto, include: RFQ_INCLUDE });
      await this.outbox.record(tx, tenantId, "rfq", id, "rfq.updated", { id });
      return result;
    });
    return updated;
  }

  async setStatus(tenantId: string, id: string, status: RFQStatus) {
    const rfq = await this.findOne(tenantId, id);
    if (!TRANSITIONS[rfq.status].includes(status)) {
      throw new ConflictException(`Geçersiz durum geçişi: ${rfq.status} → ${status}`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.rFQ.update({ where: { id }, data: { status }, include: RFQ_INCLUDE });
      await this.outbox.record(tx, tenantId, "rfq", id, "rfq.updated", { id, status });
      return result;
    });
    return updated;
  }

  async remove(tenantId: string, id: string) {
    const rfq = await this.findOne(tenantId, id);
    this.ensureDraft(rfq.status, "Sadece taslak teklif talebi silinebilir");
    const deleted = await this.prisma.$transaction(async (tx) => {
      const removed = await tx.rFQ.delete({ where: { id } });
      await this.outbox.record(tx, tenantId, "rfq", id, "rfq.updated", { id, deleted: true });
      return removed;
    });
    return deleted;
  }

  async addLine(tenantId: string, rfqId: string, dto: RfqLineInputDto) {
    const rfq = await this.findOne(tenantId, rfqId);
    this.ensureDraft(rfq.status, "Satır sadece taslak teklif talebine eklenebilir");
    const part = await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    await this.prisma.$transaction(async (tx) => {
      await tx.rFQLine.create({ data: { tenantId, rfqId, ...dto } });
      await this.outbox.record(tx, tenantId, "rfq", rfqId, "rfq.updated", { id: rfqId });
    });
    return this.findOne(tenantId, rfqId);
  }

  async updateLine(tenantId: string, rfqId: string, lineId: string, dto: UpdateRfqLineDto) {
    const rfq = await this.findOne(tenantId, rfqId);
    this.ensureDraft(rfq.status, "Satır sadece taslak teklif talebinde düzenlenebilir");
    const line = rfq.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException("Teklif talebi satırı bulunamadı");
    await this.prisma.$transaction(async (tx) => {
      await tx.rFQLine.update({ where: { id: lineId }, data: dto });
      await this.outbox.record(tx, tenantId, "rfq", rfqId, "rfq.updated", { id: rfqId });
    });
    return this.findOne(tenantId, rfqId);
  }

  async removeLine(tenantId: string, rfqId: string, lineId: string) {
    const rfq = await this.findOne(tenantId, rfqId);
    this.ensureDraft(rfq.status, "Satır sadece taslak teklif talebinde silinebilir");
    const line = rfq.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException("Teklif talebi satırı bulunamadı");
    if (rfq.lines.length <= 1) throw new ConflictException("Teklif talebinde en az bir satır kalmalı");
    await this.prisma.$transaction(async (tx) => {
      await tx.rFQLine.delete({ where: { id: lineId } });
      await this.outbox.record(tx, tenantId, "rfq", rfqId, "rfq.updated", { id: rfqId });
    });
    return this.findOne(tenantId, rfqId);
  }

  /** SENT durumundaki RFQ'yu (seçilen ya da tüm satırlarıyla) tek seferlik bir
   * Quote'a dönüştürür — RFQ bütün olarak CONVERTED'a geçer, kısmi/tekrar
   * dönüştürme desteklenmez (RFQLine'da ayrı bir durum takibi yok). */
  async convert(tenantId: string, id: string, userId: string, dto: ConvertRfqDto) {
    const rfq = await this.findOne(tenantId, id);
    if (rfq.status !== "SENT") {
      throw new ConflictException("Sadece gönderilmiş (SENT) teklif talebi teklife dönüştürülebilir");
    }
    const targetLines = dto.lineIds?.length ? rfq.lines.filter((l) => dto.lineIds!.includes(l.id)) : rfq.lines;
    if (dto.lineIds?.length && targetLines.length !== dto.lineIds.length) {
      throw new NotFoundException("Teklif talebi satırı bulunamadı");
    }
    if (targetLines.length === 0) {
      throw new ConflictException("Dönüştürülecek satır yok");
    }

    const quote = await this.prisma.$transaction(async (tx) => {
      const quoteNo = await nextDocNo(tx, "quote", "quoteNo", "TKF");
      const created = await tx.quote.create({
        data: {
          tenantId,
          quoteNo,
          customerId: rfq.customerId,
          createdById: userId,
          notes: `RFQ ${rfq.rfqNo}'dan dönüştürüldü`,
          lines: {
            create: targetLines.map((l) => ({
              tenantId,
              partId: l.part.id,
              quantity: l.quantity,
              unitPrice: 0,
              dueDate: l.dueDate,
            })),
          },
        },
      });
      await tx.rFQ.update({ where: { id: rfq.id }, data: { status: "CONVERTED" } });
      await this.outbox.record(tx, tenantId, "rfq", rfq.id, "rfq.updated", { id: rfq.id, status: "CONVERTED" });
      await this.outbox.record(tx, tenantId, "quote", created.id, "quote.updated", { id: created.id });
      return created;
    });

    return { quote };
  }

  private ensureDraft(status: RFQStatus, message: string) {
    if (status !== "DRAFT") throw new ConflictException(message);
  }
}
