import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { Reflector } from "@nestjs/core";
import type { AuditAction } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SKIP_AUDIT_KEY } from "./decorators/skip-audit.decorator";
import type { AuthUser } from "./types";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

// Rota segmenti -> Prisma model adı (before-state sorgusu için)
const ROUTE_MODEL: Record<string, string> = {
  users: "user",
  customers: "customer",
  parts: "part",
  "nc-programs": "ncProgram",
  suppliers: "supplier",
  materials: "material",
  machines: "machine",
  quotes: "quote",
  "work-orders": "workOrder",
  "purchase-orders": "purchaseOrder",
  consumptions: "materialConsumption",
  runs: "productionRun",
  "finished-goods": "finishedGoodsEntry",
  lots: "lot",
  approvals: "approvalRequest",
  documents: "document",
};

function toJson(value: unknown): object | undefined {
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    const path: string = req.path ?? "";

    const isTransactionallyAudited = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!user || !MUTATING_METHODS.has(req.method) || path.startsWith("/auth") || isTransactionallyAudited) {
      return next.handle();
    }

    const segment: string | undefined = path.split("/").filter(Boolean)[0];
    const model = segment ? ROUTE_MODEL[segment] : undefined;
    const entityId: string | undefined = req.params?.id;
    const action: AuditAction = path.endsWith("/status") || path.endsWith("/acceptance") || path.endsWith("/approve") || path.endsWith("/reject")
      ? "STATUS_CHANGE"
      : req.method === "POST"
        ? "CREATE"
        : req.method === "DELETE"
          ? "DELETE"
          : "UPDATE";

    let before: unknown = null;
    if (model && entityId && action !== "CREATE") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        before = await (this.prisma as any)[model].findUnique({ where: { id: entityId } });
      } catch {
        before = null;
      }
    }

    return next.handle().pipe(
      mergeMap(async (data: unknown) => {
        try {
          await this.prisma.auditLog.create({
            data: {
              tenantId: user.tenantId,
              userId: user.userId,
              entity: segment ?? "unknown",
              entityId: entityId ?? (data as { id?: string } | null)?.id ?? "",
              action,
              before: toJson(before),
              after: action === "DELETE" ? undefined : toJson(data),
            },
          });
        } catch (err) {
          // Audit kaydı isteği düşürmemeli, ama sessizce de kaybolmamalı
          console.error("AuditLog yazılamadı:", err);
        }
        return data;
      }),
    );
  }
}
