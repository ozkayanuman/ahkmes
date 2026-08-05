import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const TOOLING_ACTIONS = ["TOOL_READ", "TOOL_MANAGE", "TOOL_ASSEMBLY_MANAGE", "TOOL_LIFE_ADJUST", "FIXTURE_READ", "FIXTURE_MANAGE", "OPERATION_SETUP_MANAGE", "OPERATION_SETUP_VERIFY", "FIXTURE_MAINT_MANAGE", "FIXTURE_CALIBRATION_RECORD", "FIXTURE_MAINT_OVERRIDE"] as const;
export const HMI_ACTIONS = ["HMI_READ", "HMI_START", "HMI_COMPLETE"] as const;
export const ACTION_PERMISSION_ACTIONS = [...TOOLING_ACTIONS, ...HMI_ACTIONS] as const;
export type ActionPermissionAction = (typeof ACTION_PERMISSION_ACTIONS)[number];

@Injectable()
export class ActionPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async grantedActions(tenantId: string, userId: string, role: Role) {
    const grants = await this.prisma.actionPermissionGrant.findMany({ where: { tenantId, OR: [{ role }, { userId }] }, select: { action: true } });
    return [...new Set(grants.map((g) => g.action))];
  }
  async hasAll(tenantId: string, userId: string, role: Role, actions: readonly string[]) {
    const granted = new Set(await this.grantedActions(tenantId, userId, role));
    return actions.every((action) => granted.has(action));
  }
  list(tenantId: string) { return this.prisma.actionPermissionGrant.findMany({ where: { tenantId }, include: { user: { select: { id: true, name: true, email: true, role: true } } }, orderBy: [{ action: "asc" }, { createdAt: "asc" }] }); }
  async grant(tenantId: string, actorId: string, input: { action: ActionPermissionAction; role?: Role; userId?: string }) {
    if (Boolean(input.role) === Boolean(input.userId)) throw new ConflictException("Tam olarak bir rol veya kullanıcı seçilmelidir");
    if (input.userId) {
      const user = await this.prisma.user.findFirst({ where: { id: input.userId, tenantId } });
      if (!user) throw new NotFoundException("Kullanıcı bulunamadı");
    }
    const existing = await this.prisma.actionPermissionGrant.findFirst({ where: { tenantId, action: input.action, ...(input.role ? { role: input.role } : { userId: input.userId }) } });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.actionPermissionGrant.create({ data: { tenantId, action: input.action, role: input.role, userId: input.userId, createdById: actorId } });
      await tx.auditLog.create({ data: { tenantId, userId: actorId, entity: "ActionPermissionGrant", entityId: grant.id, action: "CREATE", after: { action: input.action, role: input.role, userId: input.userId } } });
      return grant;
    });
  }
  async revoke(tenantId: string, actorId: string, id: string) {
    const grant = await this.prisma.actionPermissionGrant.findFirst({ where: { id, tenantId } }); if (!grant) throw new NotFoundException("Action grant bulunamadı");
    await this.prisma.$transaction(async (tx) => { await tx.actionPermissionGrant.delete({ where: { id } }); await tx.auditLog.create({ data: { tenantId, userId: actorId, entity: "ActionPermissionGrant", entityId: id, action: "DELETE", before: { action: grant.action, role: grant.role, userId: grant.userId } } }); });
    return grant;
  }
}
