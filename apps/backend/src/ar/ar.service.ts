import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateCustomerPaymentDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { nextDocNo } from "../common/numbering";

const PAYMENT_INCLUDE = {
  customer: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  allocations: { include: { invoice: { select: { id: true, invNo: true } } } },
} as const;

/**
 * Faz G AR (Accounts Receivable): CustomerPayment/CustomerPaymentAllocation —
 * SupplierPayment (AP tarafı) ile aynı desen. Invoice/InvoiceLine zaten Faz C'den
 * beri var, burada sadece ödeme/tahsilat takibi eklenir.
 */
@Injectable()
export class ArService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  findPayments(tenantId: string, customerId?: string) {
    return this.prisma.customerPayment.findMany({
      where: { tenantId, ...(customerId ? { customerId } : {}) },
      include: PAYMENT_INCLUDE,
      orderBy: { paymentDate: "desc" },
    });
  }

  /** Ödeme, bir veya birden fazla ISSUED faturaya bölüştürülür; her tahsis, o faturanın
   * kalan bakiyesini (toplam - önceden tahsis edilmiş) aşamaz. amount, tahsis toplamından türetilir. */
  async createPayment(tenantId: string, userId: string, dto: CreateCustomerPaymentDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: dto.customerId, tenantId } });
      if (!customer) throw new NotFoundException("Müşteri bulunamadı");

      let totalAmount = 0;
      for (const a of dto.allocations) {
        const invoice = await tx.invoice.findFirst({
          where: { id: a.invoiceId, tenantId, salesOrder: { customerId: dto.customerId } },
          include: { lines: true, allocations: true },
        });
        if (!invoice) throw new NotFoundException("Fatura bulunamadı");
        if (invoice.status !== "ISSUED") throw new ConflictException("Sadece kesilmiş faturaya ödeme tahsis edilebilir");

        const total = invoice.lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.unitPrice), 0);
        const allocated = invoice.allocations.reduce((sum, x) => sum + Number(x.amount), 0);
        const remaining = total - allocated;
        if (a.amount > remaining + 1e-9) {
          throw new ConflictException(
            `Tahsis edilen tutar fatura bakiyesini aşıyor: ${invoice.invNo} — bakiye ${remaining.toFixed(2)}, tahsis ${a.amount}`,
          );
        }
        totalAmount += a.amount;
      }

      const cpNo = await nextDocNo(tx, "customerPayment", "cpNo", "MO");
      return tx.customerPayment.create({
        data: {
          tenantId,
          cpNo,
          customerId: dto.customerId,
          amount: totalAmount,
          paymentDate: dto.paymentDate ?? new Date(),
          notes: dto.notes,
          createdById: userId,
          allocations: {
            create: dto.allocations.map((a) => ({ tenantId, invoiceId: a.invoiceId, amount: a.amount })),
          },
        },
        include: PAYMENT_INCLUDE,
      });
    });

    this.realtime.emitToTenant(tenantId, "customerpayment.created", { id: created.id, customerId: dto.customerId });
    return created;
  }

  /**
   * Müşteri bazında açık bakiye: ISSUED faturaların toplamı - tahsis edilen
   * ödemeler. Faz P: para birimine göre AYRI ayrı gruplanır — farklı kurlar
   * (örn. bir fatura TRY, diğeri USD) toplanırsa anlamsız/yanıltıcı bir tutar
   * ortaya çıkardı; bu yüzden anahtar customerId+currency (sadece customerId
   * değil).
   */
  async summary(tenantId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId, status: "ISSUED" },
      include: {
        lines: true,
        allocations: true,
        salesOrder: { select: { customerId: true, customer: { select: { id: true, name: true } } } },
      },
    });

    const byCustomer = new Map<
      string,
      { customerId: string; customerName: string; currency: string; outstanding: number }
    >();
    for (const inv of invoices) {
      const total = inv.lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.unitPrice), 0);
      const allocated = inv.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
      const outstanding = total - allocated;
      const customerId = inv.salesOrder.customerId;
      const key = `${customerId}:${inv.currency}`;
      const entry = byCustomer.get(key) ?? {
        customerId,
        customerName: inv.salesOrder.customer.name,
        currency: inv.currency,
        outstanding: 0,
      };
      entry.outstanding += outstanding;
      byCustomer.set(key, entry);
    }
    return Array.from(byCustomer.values()).sort((a, b) => b.outstanding - a.outstanding);
  }
}
