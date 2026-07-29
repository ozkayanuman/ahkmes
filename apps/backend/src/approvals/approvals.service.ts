import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

const INCLUDE = {
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} as const;

/** Genel amaçlı onay motoru — belirli bir entity'ye gömülü değildir. Diğer
 * modüller (ör. ileriki fazlarda MRP proposal, CAPA) `request()`i çağırıp
 * kendi entity/entityId çiftini kaydeder; bu modül sadece karar akışını
 * (PENDING→APPROVED/REJECTED) ve geçmişini yönetir. */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  request(
    tenantId: string,
    requestedById: string,
    input: { entity: string; entityId: string; requiredRoles: Role[]; note?: string },
  ) {
    return this.prisma.approvalRequest.create({
      data: { tenantId, requestedById, ...input },
      include: INCLUDE,
    });
  }

  list(tenantId: string, role: Role, status?: "PENDING" | "APPROVED" | "REJECTED") {
    return this.prisma.approvalRequest.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        // ADMIN her zaman görür; diğer roller sadece kendilerine atanan taleplerde.
        ...(role === "ADMIN" ? {} : { requiredRoles: { has: role } }),
      },
      include: INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  private async decide(
    tenantId: string,
    id: string,
    decidedById: string,
    decidedRole: Role,
    status: "APPROVED" | "REJECTED",
    note?: string,
  ) {
    const req = await this.prisma.approvalRequest.findFirst({ where: { id, tenantId } });
    if (!req) throw new NotFoundException("Onay talebi bulunamadı");
    if (req.status !== "PENDING") throw new ConflictException("Bu talep zaten karara bağlanmış");
    if (decidedRole !== "ADMIN" && !req.requiredRoles.includes(decidedRole)) {
      throw new ForbiddenException("Bu talebi karara bağlama yetkiniz yok");
    }

    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status, decidedById, decidedAt: new Date(), decisionNote: note },
      include: INCLUDE,
    });

    await this.notifications.notifyUser(tenantId, req.requestedById, {
      type: status === "APPROVED" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED",
      title: status === "APPROVED" ? "Onay talebiniz onaylandı" : "Onay talebiniz reddedildi",
      message: note ?? `${req.entity} için onay talebi karara bağlandı`,
      entity: req.entity,
      entityId: req.entityId,
    });

    return updated;
  }

  approve(tenantId: string, id: string, decidedById: string, decidedRole: Role, note?: string) {
    return this.decide(tenantId, id, decidedById, decidedRole, "APPROVED", note);
  }

  reject(tenantId: string, id: string, decidedById: string, decidedRole: Role, note?: string) {
    return this.decide(tenantId, id, decidedById, decidedRole, "REJECTED", note);
  }
}
