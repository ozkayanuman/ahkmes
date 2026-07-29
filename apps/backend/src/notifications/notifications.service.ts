import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import type { Role } from "@prisma/client";

interface NotifyInput {
  type: string;
  title: string;
  message: string;
  entity?: string;
  entityId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  list(tenantId: string, userId: string) {
    return this.prisma.notification.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  unreadCount(tenantId: string, userId: string) {
    return this.prisma.notification.count({ where: { tenantId, userId, isRead: false } });
  }

  async markRead(tenantId: string, userId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, tenantId, userId }, data: { isRead: true } });
  }

  async markAllRead(tenantId: string, userId: string) {
    await this.prisma.notification.updateMany({ where: { tenantId, userId, isRead: false }, data: { isRead: true } });
  }

  /** Tek bir kullanıcıya bildirim oluşturur ve o kullanıcının tenant odasına yayınlar
   * (istemci payload.userId'yi kendi kimliğiyle eşleştirip filtreler). */
  async notifyUser(tenantId: string, userId: string, input: NotifyInput) {
    const created = await this.prisma.notification.create({
      data: { tenantId, userId, ...input },
    });
    this.realtime.emitToTenant(tenantId, "notification.created", { userId, id: created.id });
    return created;
  }

  /** Verilen rollerdeki tüm kullanıcılara aynı bildirimi oluşturur — üretici servisler
   * (NonConformance, Machine ALARM vb.) bunu çağırır. */
  async notifyRoles(tenantId: string, roles: Role[], input: NotifyInput) {
    const recipients = await this.prisma.user.findMany({
      where: { tenantId, role: { in: roles }, isActive: true },
      select: { id: true },
    });
    await Promise.all(recipients.map((r) => this.notifyUser(tenantId, r.id, input)));
  }
}
