import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateServiceTicketDto, ResolveServiceTicketDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { AppException } from "../common/app-exception";
import { NotificationsService } from "../notifications/notifications.service";

const INCLUDE = {
  customer: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ServiceTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  findAll(tenantId: string, customerId?: string, status?: string) {
    return this.prisma.serviceTicket.findMany({
      where: { tenantId, ...(customerId ? { customerId } : {}), ...(status ? { status: status as never } : {}) },
      include: INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const ticket = await this.prisma.serviceTicket.findFirst({ where: { id, tenantId }, include: INCLUDE });
    if (!ticket) throw new NotFoundException("Servis talebi bulunamadı");
    return ticket;
  }

  async create(tenantId: string, createdById: string, dto: CreateServiceTicketDto) {
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } });
    if (!customer) throw new NotFoundException("Müşteri bulunamadı");

    const created = await this.prisma.serviceTicket.create({
      data: { ...dto, tenantId, createdById },
      include: INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "serviceticket.updated", { id: created.id, customerId: dto.customerId });
    await this.notifications.notifyRoles(tenantId, ["ADMIN", "SALES"], {
      type: "SERVICE_TICKET_CREATED",
      title: "Yeni servis talebi",
      message: `${customer.name}: ${dto.subject}`,
      entity: "service-tickets",
      entityId: created.id,
    });
    return created;
  }

  /**
   * NonConformance.resolve() ile birebir aynı desen: status=RESOLVED'a
   * geçerken çözüm notu zorunlu (kayıt zaten çözümlüyse tekrar istenmez —
   * örn. RESOLVED→CLOSED geçişinde önceki notu korur).
   */
  async resolve(tenantId: string, id: string, dto: ResolveServiceTicketDto) {
    const ticket = await this.findOne(tenantId, id);
    if (dto.status === "RESOLVED" && !ticket.resolutionNote && !dto.resolutionNote?.trim()) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "RESOLUTION_NOTE_REQUIRED",
        "Talebi çözümlemek için çözüm açıklaması (ne yapıldığı) girilmeli",
      );
    }

    const updated = await this.prisma.serviceTicket.update({
      where: { id },
      data: {
        status: dto.status,
        resolvedAt: dto.status === "RESOLVED" ? (ticket.resolvedAt ?? new Date()) : ticket.resolvedAt,
        resolutionNote: dto.resolutionNote?.trim() || ticket.resolutionNote,
      },
      include: INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "serviceticket.updated", { id, customerId: ticket.customerId });
    return updated;
  }
}
