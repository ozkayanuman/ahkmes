import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateCustomerNoteDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const NOTE_INCLUDE = {
  author: { select: { id: true, name: true } },
} as const;

/** Basit CRM: müşteri aktivite notları — append-only (AuditLog felsefesiyle
 * tutarlı, düzenleme/silme yok). Lead/fırsat pipeline'ı kapsam dışı. */
@Injectable()
export class CustomerNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async ensureCustomer(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) throw new NotFoundException("Müşteri bulunamadı");
  }

  async list(tenantId: string, customerId: string) {
    await this.ensureCustomer(tenantId, customerId);
    return this.prisma.customerNote.findMany({
      where: { tenantId, customerId },
      include: NOTE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async create(tenantId: string, customerId: string, authorId: string, dto: CreateCustomerNoteDto) {
    await this.ensureCustomer(tenantId, customerId);
    const created = await this.prisma.customerNote.create({
      data: { tenantId, customerId, authorId, note: dto.note },
      include: NOTE_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "customernote.created", { customerId, id: created.id });
    return created;
  }
}
