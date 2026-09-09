import type { AuditAction } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

type AuditClient = Pick<PrismaService, "auditLog">;

function jsonValue(value: unknown): object | undefined {
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

/**
 * Writes an audit row with the caller's transaction client. It intentionally
 * throws on failure, so a critical command cannot commit without its audit trail.
 */
export function writeTransactionalAudit(
  client: AuditClient,
  input: {
    tenantId: string;
    userId: string;
    entity: string;
    entityId: string;
    action: AuditAction;
    before?: unknown;
    after?: unknown;
  },
) {
  return client.auditLog.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      before: jsonValue(input.before),
      after: jsonValue(input.after),
    },
  });
}
