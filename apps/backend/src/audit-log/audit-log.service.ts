import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

interface AuditLogFilters {
  entity?: string;
  entityId?: string;
  userId?: string;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Denetim izi (audit trail) — kim/ne zaman/neyi değiştirdi. AuditInterceptor
   * tarafından tüm mutasyon isteklerinde (POST/PATCH/PUT/DELETE) otomatik yazılır. */
  async list(tenantId: string, filters: AuditLogFilters) {
    return this.prisma.auditLog.findMany({
      where: {
        tenantId,
        ...(filters.entity ? { entity: filters.entity } : {}),
        ...(filters.entityId ? { entityId: filters.entityId } : {}),
        ...(filters.userId ? { userId: filters.userId } : {}),
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  /** Filtre dropdown'ları için: bu tenant'ta gerçekten kayıt olan varlık türleri. */
  async entities(tenantId: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId },
      distinct: ["entity"],
      select: { entity: true },
    });
    return rows.map((r) => r.entity).sort();
  }
}
