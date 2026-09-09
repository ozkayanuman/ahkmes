import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateInvoiceDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { nextDocNo } from "../common/numbering";

const INVOICE_INCLUDE = {
  salesOrder: { select: { id: true, soNo: true, customerId: true, customer: { select: { id: true, name: true } } } },
  createdBy: { select: { id: true, name: true } },
  lines: {
    include: {
      salesOrderLine: {
        select: { id: true, part: { select: { id: true, partNo: true, name: true } } },
      },
    },
  },
  // Faz G AR: ödeme tahsislerinin toplamı — kalan bakiye (total - allocated) web
  // tarafında hesaplanır, ayrı bir "balance" alanı persist edilmez.
  allocations: { select: { amount: true } },
} as const;

/** Fatura — sadece kesildi/iptal durumu var, ödeme/AR takibi yok (Faz G
 * kapsamı). Sevk edilmiş-henüz faturalanmamış miktara karşı netlenir; iptalde
 * SalesOrderLine.invoicedQty geri düşürülür (PartStock'a dokunulmaz — fatura
 * fiziksel stok hareketi değil). */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  findAll(tenantId: string, salesOrderId?: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId, ...(salesOrderId ? { salesOrderId } : {}) },
      include: INVOICE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, tenantId }, include: INVOICE_INCLUDE });
    if (!inv) throw new NotFoundException("Fatura bulunamadı");
    return inv;
  }

  async create(tenantId: string, userId: string, dto: CreateInvoiceDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      // Sipariş ve miktar kontrolleri transaction içinde taze veriyle yapılır —
      // aksi halde iki eşzamanlı fatura isteği aynı "kalan miktar" anlık
      // görüntüsünü kullanıp ikisi de geçerse fazla faturalanabilir.
      const so = await tx.salesOrder.findFirst({
        where: { id: dto.salesOrderId, tenantId },
        include: { lines: { include: { part: { select: { id: true, partNo: true } } } } },
      });
      if (!so) throw new NotFoundException("Satış siparişi bulunamadı");

      const lineById = new Map(so.lines.map((l) => [l.id, l]));
      for (const l of dto.lines) {
        const line = lineById.get(l.salesOrderLineId);
        if (!line) throw new NotFoundException("Sipariş satırı bulunamadı");
        const remaining = Number(line.shippedQty) - Number(line.invoicedQty);
        if (l.qty > remaining + 1e-9) {
          throw new ConflictException(
            `Faturalanabilir miktar aşıldı: ${line.part.partNo} — sevk edilen ${Number(line.shippedQty)}, faturalanan ${Number(line.invoicedQty)}, kalan ${remaining}`,
          );
        }
      }

      const invNo = await nextDocNo(tx, "invoice", "invNo", "FAT");
      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          invNo,
          salesOrderId: dto.salesOrderId,
          currency: so.currency,
          notes: dto.notes,
          createdById: userId,
          lines: {
            create: dto.lines.map((l) => ({
              tenantId,
              salesOrderLineId: l.salesOrderLineId,
              qty: l.qty,
              unitPrice: lineById.get(l.salesOrderLineId)!.unitPrice,
            })),
          },
        },
        include: INVOICE_INCLUDE,
      });

      for (const l of dto.lines) {
        await tx.salesOrderLine.update({
          where: { id: l.salesOrderLineId },
          data: { invoicedQty: { increment: l.qty } },
        });
      }

      await this.outbox.record(tx, tenantId, "invoice", invoice.id, "invoice.created", { id: invoice.id, salesOrderId: dto.salesOrderId });
      await this.outbox.record(tx, tenantId, "salesorder", dto.salesOrderId, "salesorder.updated", { id: dto.salesOrderId });

      return invoice;
    });

    return created;
  }

  async cancel(tenantId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, tenantId }, include: { lines: true } });
    if (!invoice) throw new NotFoundException("Fatura bulunamadı");
    if (invoice.status !== "ISSUED") {
      throw new ConflictException("Sadece kesilmiş (ISSUED) fatura iptal edilebilir");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const l of invoice.lines) {
        await tx.salesOrderLine.update({
          where: { id: l.salesOrderLineId },
          data: { invoicedQty: { decrement: l.qty } },
        });
      }
      const updated = await tx.invoice.update({ where: { id }, data: { status: "CANCELLED" }, include: INVOICE_INCLUDE });
      await this.outbox.record(tx, tenantId, "invoice", id, "invoice.updated", { id, status: "CANCELLED" });
      await this.outbox.record(tx, tenantId, "salesorder", invoice.salesOrderId, "salesorder.updated", { id: invoice.salesOrderId });
      return updated;
    });

    return updated;
  }
}
