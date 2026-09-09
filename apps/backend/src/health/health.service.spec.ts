import { HealthService } from "./health.service";

describe("HealthService", () => {
  const prisma = { $queryRawUnsafe: jest.fn() };
  const minio = { isReady: jest.fn() };
  const service = new HealthService(prisma as never, minio as never);

  beforeEach(() => jest.resetAllMocks());

  it("is ready only when database, schema and document storage are available", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    minio.isReady.mockResolvedValue(true);
    await expect(service.readiness()).resolves.toEqual({ status: "ok", checks: { database: "ok", schema: "ok", storage: "ok" } });
  });

  it("does not report an unavailable storage dependency as ready", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    minio.isReady.mockResolvedValue(false);
    await expect(service.readiness()).resolves.toEqual({ status: "not_ready", checks: { database: "ok", schema: "ok", storage: "unavailable" } });
  });
});
