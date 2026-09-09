import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import { finalize } from "rxjs/operators";
import type { AuthUser } from "../types";

/** Structured, deliberately body-free request diagnostics for on-prem support. */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("Request");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method: string; originalUrl?: string; url: string; headers: Record<string, string | undefined>; user?: AuthUser; params?: Record<string, string> }>();
    const response = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void; statusCode: number }>();
    const candidate = request.headers["x-request-id"];
    const requestId = candidate && /^[A-Za-z0-9._-]{1,128}$/.test(candidate) ? candidate : randomUUID();
    response.setHeader("X-Request-Id", requestId);
    const started = Date.now();
    return next.handle().pipe(finalize(() => {
      this.logger.log(JSON.stringify({
        event: "http_request",
        requestId,
        method: request.method,
        path: request.originalUrl ?? request.url,
        statusCode: response.statusCode,
        durationMs: Date.now() - started,
        tenantId: request.user?.tenantId,
        userId: request.user?.userId,
        machineId: request.params?.id,
      }));
    }));
  }
}
