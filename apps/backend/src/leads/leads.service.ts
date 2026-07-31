import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateLeadDto, UpdateLeadDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.lead.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  }

  async findOne(tenantId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id, tenantId } });
    if (!lead) throw new NotFoundException("Potansiyel müşteri bulunamadı");
    return lead;
  }

  create(tenantId: string, dto: CreateLeadDto) {
    return this.prisma.lead.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateLeadDto) {
    const lead = await this.findOne(tenantId, id);
    if (lead.status === "CONVERTED") {
      throw new ConflictException("Dönüştürülmüş bir potansiyel müşteri düzenlenemez");
    }
    return this.prisma.lead.update({ where: { id: lead.id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    const lead = await this.findOne(tenantId, id);
    return this.prisma.lead.delete({ where: { id: lead.id } });
  }

  /**
   * Quote.convert() → SalesOrder deseniyle aynı mantık: tek yönlü, geri
   * alınamaz bir dönüşüm. Lead'in iletişim bilgilerinden yeni bir Customer
   * kaydı üretir, Lead.status=CONVERTED + convertedCustomerId set edilir.
   */
  async convert(tenantId: string, id: string) {
    const lead = await this.findOne(tenantId, id);
    if (lead.status === "CONVERTED") {
      throw new ConflictException("Bu potansiyel müşteri zaten dönüştürülmüş");
    }

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          tenantId,
          name: lead.companyName,
          contactName: lead.contactName,
          email: lead.email,
          phone: lead.phone,
        },
      });
      return tx.lead.update({
        where: { id: lead.id },
        data: { status: "CONVERTED", convertedCustomerId: customer.id },
        include: { convertedCustomer: true },
      });
    });
  }
}
