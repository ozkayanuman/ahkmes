import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateSupplierInvoiceDto, CreateSupplierPaymentDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { nextDocNo } from "../common/numbering";

const INVOICE_INCLUDE = {
  purchaseOrder: { select: { id: true, poNo: true } },
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  lines: {
    include: {
      purchaseOrderLine: { include: { material: { select: { id: true, code: true, name: true } } } },
    },
  },
  allocations: { select: { amount: true } },
} as const;

const PAYMENT_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  allocations: { include: { supplierInvoice: { select: { id: true, sinNo: true } } } },
} as const;

/**
 * Faz G AP (Accounts Payable): SupplierInvoice (Invoice/InvoiceLine ile aynı desen,
 * alım tarafı) + SupplierPayment/SupplierPaymentAllocation (ödemenin bir veya birden
 * fazla faturaya bölüştürülmesi). Genel muhasebe/e-Fatura kapsam dışı (Faz G MVP kararı).
 */
@Injectable()
export class ApService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  findInvoices(tenantId: string, purchaseOrderId?: string) {
    return this.prisma.supplierInvoice.findMany({
      where: { tenantId, ...(purchaseOrderId ? { purchaseOrderId } : {}) },
      include: INVOICE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findInvoice(tenantId: string, id: string) {
    const inv = await this.prisma.supplierInvoice.findFirst({ where: { id, tenantId }, include: INVOICE_INCLUDE });
    if (!inv) throw new NotFoundException("Tedarikçi faturası bulunamadı");
    return inv;
  }

  async createInvoice(tenantId: string, userId: string, dto: CreateSupplierInvoiceDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      // Miktar kontrolü transaction içinde taze veriyle yapılır (Invoice/Delivery ile
      // aynı desen) — iki eşzamanlı istek aynı "kalan miktar" görüntüsünü kullanıp
      // ikisi de geçerse fazla faturalanabilir.
      const po = await tx.purchaseOrder.findFirst({
        where: { id: dto.purchaseOrderId, tenantId },
        include: { lines: { include: { material: { select: { id: true, code: true } } } } },
      });
      if (!po) throw new NotFoundException("Satınalma siparişi bulunamadı");

      const lineById = new Map(po.lines.map((l) => [l.id, l]));
      for (const l of dto.lines) {
        const line = lineById.get(l.purchaseOrderLineId);
        if (!line) throw new NotFoundException("Sipariş satırı bulunamadı");
        const remaining = Number(line.receivedQty) - Number(line.invoicedQty);
        if (l.qty > remaining + 1e-9) {
          throw new ConflictException(
            `Faturalanabilir miktar aşıldı: ${line.material.code} — teslim alınan ${Number(line.receivedQty)}, faturalanan ${Number(line.invoicedQty)}, kalan ${remaining}`,
          );
        }
      }

      const sinNo = await nextDocNo(tx, "supplierInvoice", "sinNo", "TF");
      const invoice = await tx.supplierInvoice.create({
        data: {
          tenantId,
          sinNo,
          purchaseOrderId: dto.purchaseOrderId,
          supplierId: po.supplierId,
          currency: po.currency,
          notes: dto.notes,
          createdById: userId,
          lines: {
            create: dto.lines.map((l) => ({
              tenantId,
              purchaseOrderLineId: l.purchaseOrderLineId,
              qty: l.qty,
              unitPrice: lineById.get(l.purchaseOrderLineId)!.unitPrice,
            })),
          },
        },
        include: INVOICE_INCLUDE,
      });

      for (const l of dto.lines) {
        await tx.purchaseOrderLine.update({
          where: { id: l.purchaseOrderLineId },
          data: { invoicedQty: { increment: l.qty } },
        });
      }

      await this.outbox.record(tx, tenantId, "supplierinvoice", invoice.id, "supplierinvoice.created", {
        id: invoice.id,
        purchaseOrderId: dto.purchaseOrderId,
      });
      return invoice;
    });

    return created;
  }

  async cancelInvoice(tenantId: string, id: string) {
    const invoice = await this.prisma.supplierInvoice.findFirst({ where: { id, tenantId }, include: { lines: true } });
    if (!invoice) throw new NotFoundException("Tedarikçi faturası bulunamadı");
    if (invoice.status !== "ISSUED") {
      throw new ConflictException("Sadece kesilmiş (ISSUED) fatura iptal edilebilir");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const l of invoice.lines) {
        await tx.purchaseOrderLine.update({
          where: { id: l.purchaseOrderLineId },
          data: { invoicedQty: { decrement: l.qty } },
        });
      }
      const updated = await tx.supplierInvoice.update({ where: { id }, data: { status: "CANCELLED" }, include: INVOICE_INCLUDE });
      await this.outbox.record(tx, tenantId, "supplierinvoice", id, "supplierinvoice.updated", { id, status: "CANCELLED" });
      return updated;
    });

    return updated;
  }

  findPayments(tenantId: string, supplierId?: string) {
    return this.prisma.supplierPayment.findMany({
      where: { tenantId, ...(supplierId ? { supplierId } : {}) },
      include: PAYMENT_INCLUDE,
      orderBy: { paymentDate: "desc" },
    });
  }

  /** Ödeme, bir veya birden fazla ISSUED faturaya bölüştürülür; her tahsis, o faturanın
   * kalan bakiyesini (toplam - önceden tahsis edilmiş) aşamaz. amount, tahsis toplamından türetilir. */
  async createPayment(tenantId: string, userId: string, dto: CreateSupplierPaymentDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: dto.supplierId, tenantId } });
      if (!supplier) throw new NotFoundException("Tedarikçi bulunamadı");

      let totalAmount = 0;
      for (const a of dto.allocations) {
        const invoice = await tx.supplierInvoice.findFirst({
          where: { id: a.supplierInvoiceId, tenantId, supplierId: dto.supplierId },
          include: { lines: true, allocations: true },
        });
        if (!invoice) throw new NotFoundException("Tedarikçi faturası bulunamadı");
        if (invoice.status !== "ISSUED") throw new ConflictException("Sadece kesilmiş faturaya ödeme tahsis edilebilir");

        const total = invoice.lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.unitPrice), 0);
        const allocated = invoice.allocations.reduce((sum, x) => sum + Number(x.amount), 0);
        const remaining = total - allocated;
        if (a.amount > remaining + 1e-9) {
          throw new ConflictException(
            `Tahsis edilen tutar fatura bakiyesini aşıyor: ${invoice.sinNo} — bakiye ${remaining.toFixed(2)}, tahsis ${a.amount}`,
          );
        }
        totalAmount += a.amount;
      }

      const spNo = await nextDocNo(tx, "supplierPayment", "spNo", "TOD");
      const payment = await tx.supplierPayment.create({
        data: {
          tenantId,
          spNo,
          supplierId: dto.supplierId,
          amount: totalAmount,
          paymentDate: dto.paymentDate ?? new Date(),
          notes: dto.notes,
          createdById: userId,
          allocations: {
            create: dto.allocations.map((a) => ({
              tenantId,
              supplierInvoiceId: a.supplierInvoiceId,
              amount: a.amount,
            })),
          },
        },
        include: PAYMENT_INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "supplierpayment", payment.id, "supplierpayment.created", { id: payment.id, supplierId: dto.supplierId });
      return payment;
    });

    return created;
  }

  /**
   * Tedarikçi bazında açık bakiye — Faz P: AR.summary() ile aynı düzeltme,
   * customerId yerine supplierId için: para birimine göre ayrı gruplanır.
   */
  async summary(tenantId: string) {
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: { tenantId, status: "ISSUED" },
      include: { lines: true, allocations: true, supplier: { select: { id: true, name: true } } },
    });

    const bySupplier = new Map<
      string,
      { supplierId: string; supplierName: string; currency: string; outstanding: number }
    >();
    for (const inv of invoices) {
      const total = inv.lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.unitPrice), 0);
      const allocated = inv.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
      const outstanding = total - allocated;
      const key = `${inv.supplierId}:${inv.currency}`;
      const entry = bySupplier.get(key) ?? {
        supplierId: inv.supplierId,
        supplierName: inv.supplier.name,
        currency: inv.currency,
        outstanding: 0,
      };
      entry.outstanding += outstanding;
      bySupplier.set(key, entry);
    }
    return Array.from(bySupplier.values()).sort((a, b) => b.outstanding - a.outstanding);
  }
}
