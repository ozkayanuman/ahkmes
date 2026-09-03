import { Injectable } from "@nestjs/common";
import { MinioService } from "../documents/minio.service";
import { PrismaService } from "../prisma/prisma.service";

export interface ReadinessResult {
  status: "ok" | "not_ready";
  checks: { database: "ok" | "unavailable"; schema: "ok" | "unavailable"; storage: "ok" | "unavailable" };
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService, private readonly minio: MinioService) {}

  live() {
    return { status: "ok", uptime: Math.floor(process.uptime()) };
  }

  info() {
    return {
      application: "ahkmes-backend",
      version: process.env.APP_VERSION ?? "0.1.0",
      build: process.env.BUILD_SHA ?? "unknown",
    };
  }

  async readiness(): Promise<ReadinessResult> {
    const checks: ReadinessResult["checks"] = { database: "unavailable", schema: "unavailable", storage: "unavailable" };
    try {
      await this.prisma.$queryRawUnsafe("SELECT 1");
      checks.database = "ok";
      // This detects an unmigrated/partially initialized database without exposing
      // migration names or database host details to unauthenticated callers.
      await this.prisma.$queryRawUnsafe('SELECT 1 FROM "_prisma_migrations" LIMIT 1');
      checks.schema = "ok";
    } catch {
      // The public response remains intentionally coarse; server logs retain the request correlation id.
    }
    if (await this.minio.isReady()) checks.storage = "ok";
    const ready = Object.values(checks).every((check) => check === "ok");
    return { status: ready ? "ok" : "not_ready", checks };
  }
}
