import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { writeTransactionalAudit } from "../common/transactional-audit";

const INCLUDE = {
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} as const;

type ApprovalClient = Pick<PrismaService, "approvalRequest" | "auditLog">;

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

  async request(
    tenantId: string,
    requestedById: string,
    input: { entity: string; entityId: string; requiredRoles: Role[]; note?: string },
    client?: ApprovalClient,
  ): Promise<any> {
    if (!client) {
      return this.prisma.$transaction((tx) => this.request(tenantId, requestedById, input, tx));
    }
    const requestSnapshot = { entity: input.entity, entityId: input.entityId, requiredRoles: [...input.requiredRoles].sort(), note: input.note ?? null };
    const requestHash = createHash("sha256").update(JSON.stringify(requestSnapshot)).digest("hex");
    const created = await client.approvalRequest.create({
      data: { tenantId, requestedById, ...input, requestSnapshot, requestHash },
      include: INCLUDE,
    });
    await writeTransactionalAudit(client, {
      tenantId,
      userId: requestedById,
      entity: "approval-requests",
      entityId: created.id,
      action: "CREATE",
      after: created,
    });
    return created;
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

  private async decideInTransaction(
    tenantId: string,
    id: string,
    decidedById: string,
    decidedRole: Role,
    status: "APPROVED" | "REJECTED",
    note: string | undefined,
    client: ApprovalClient,
  ) {
    const req = await client.approvalRequest.findFirst({ where: { id, tenantId } });
    if (!req) throw new NotFoundException("Onay talebi bulunamadı");
    if (req.status !== "PENDING") throw new ConflictException("Bu talep zaten karara bağlanmış");
    if (req.requestedById === decidedById) {
      throw new ForbiddenException("Talebi oluşturan kullanıcı kendi talebini onaylayamaz veya reddedemez");
    }
    if (decidedRole !== "ADMIN" && !req.requiredRoles.includes(decidedRole)) {
      throw new ForbiddenException("Bu talebi karara bağlama yetkiniz yok");
    }

    const updated = await client.approvalRequest.update({
      where: { id },
      data: { status, decidedById, decidedAt: new Date(), decisionNote: note },
      include: INCLUDE,
    });

    await writeTransactionalAudit(client, {
      tenantId,
      userId: decidedById,
      entity: "approval-requests",
      entityId: req.id,
      action: "STATUS_CHANGE",
      before: { status: req.status, decisionNote: req.decisionNote, decidedById: req.decidedById },
      after: { status: updated.status, decisionNote: updated.decisionNote, decidedById: decidedById },
    });

    return { updated, request: req };
  }

  async notifyDecision(
    tenantId: string,
    request: { requestedById: string; entity: string; entityId: string },
    status: "APPROVED" | "REJECTED",
    note?: string,
  ) {
    await this.notifications.notifyUser(tenantId, request.requestedById, {
      type: status === "APPROVED" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED",
      title: status === "APPROVED" ? "Onay talebiniz onaylandı" : "Onay talebiniz reddedildi",
      message: note ?? `${request.entity} için onay talebi karara bağlandı`,
      entity: request.entity,
      entityId: request.entityId,
    });
  }

  async approve(tenantId: string, id: string, decidedById: string, decidedRole: Role, note?: string, client?: ApprovalClient, notify = true) {
    if (client) return (await this.decideInTransaction(tenantId, id, decidedById, decidedRole, "APPROVED", note, client)).updated;
    const result = await this.prisma.$transaction((tx) => this.decideInTransaction(tenantId, id, decidedById, decidedRole, "APPROVED", note, tx));
    if (notify) await this.notifyDecision(tenantId, result.request, "APPROVED", note);
    return result.updated;
  }

  async reject(tenantId: string, id: string, decidedById: string, decidedRole: Role, note?: string, client?: ApprovalClient, notify = true) {
    if (client) return (await this.decideInTransaction(tenantId, id, decidedById, decidedRole, "REJECTED", note, client)).updated;
    const result = await this.prisma.$transaction((tx) => this.decideInTransaction(tenantId, id, decidedById, decidedRole, "REJECTED", note, tx));
    if (notify) await this.notifyDecision(tenantId, result.request, "REJECTED", note);
    return result.updated;
  }
}
