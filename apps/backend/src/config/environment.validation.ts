import { z } from "zod";

const placeholderSecrets = new Set([
  "change-me",
  "change-me-min-32-chars-random-string",
  "replace-with-a-long-random-secret",
  "ahkmes",
]);

const truthy = z.enum(["true", "false"]).optional();

/**
 * The application deliberately accepts useful local defaults outside production,
 * but a production process must never come up with the example-file credentials
 * or an unrestricted browser origin. Keep this independent from Compose: a
 * customer may run the backend directly on-premise.
 */
export function validateEnvironment(input: Record<string, unknown>) {
  const parsed = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url().refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), "DATABASE_URL must be a PostgreSQL URL"),
    JWT_SECRET: z.string().min(16),
    BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGINS: z.string().optional(),
    MINIO_ENDPOINT: z.string().min(1).default("localhost"),
    MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
    MINIO_USE_SSL: truthy.default("false"),
    MINIO_ROOT_USER: z.string().min(3),
    MINIO_ROOT_PASSWORD: z.string().min(8),
    MINIO_BUCKET: z.string().min(3).default("ahkmes-documents"),
    MINIO_PUBLIC_ENDPOINT: z.string().min(1).default("localhost"),
    MINIO_PUBLIC_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
    PUBLIC_APP_URL: z.string().url().optional(),
    PUBLIC_WEB_URL: z.string().url().optional(),
    APP_VERSION: z.string().max(128).optional(),
    BUILD_SHA: z.string().max(128).optional(),
    LOG_LEVEL: z.enum(["error", "warn", "log", "debug", "verbose"]).default("log"),
  }).parse(input);

  if (parsed.NODE_ENV === "production") {
    const forbidden = [parsed.JWT_SECRET, parsed.MINIO_ROOT_PASSWORD].some((value) => placeholderSecrets.has(value.toLowerCase()));
    if (forbidden || parsed.JWT_SECRET.length < 32) {
      throw new Error("Production JWT_SECRET and MINIO_ROOT_PASSWORD must be non-placeholder secrets; JWT_SECRET must be at least 32 characters");
    }
    if (!parsed.CORS_ORIGINS || parsed.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean).length === 0 || parsed.CORS_ORIGINS.includes("*")) {
      throw new Error("Production CORS_ORIGINS must contain one or more explicit origins and must not contain '*'");
    }
    if (!parsed.PUBLIC_APP_URL || !parsed.PUBLIC_WEB_URL) {
      throw new Error("Production PUBLIC_APP_URL and PUBLIC_WEB_URL are required");
    }
  }

  return parsed;
}

export function corsOrigins(value: string | undefined): string[] {
  return (value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
}
