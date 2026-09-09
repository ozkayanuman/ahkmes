import { ConflictException, NotFoundException } from "@nestjs/common";
import { PartsService } from "./parts.service";

function program(overrides: Record<string, unknown> = {}) {
  return {
    id: "nc-1", tenantId: "tenant-a", partId: "part-a", version: 1,
    storageKey: "tenant-a/nc.nc", sizeBytes: 12, checksum: "a".repeat(64), checksumAlgorithm: "SHA-256",
    status: "PUBLISHED", effectivityScope: "GLOBAL", effectiveFrom: null, effectiveTo: null,
    ...overrides,
  };
}

function build(found: unknown) {
  const prisma: any = { ncProgram: { findFirst: jest.fn().mockResolvedValue(found) } };
  const service = new PartsService(prisma, {} as any, {} as any, {} as any);
  return { service, prisma };
}

describe("PartsService.assertNcProgramUsable (PLM-001)", () => {
  it("accepts only a published NC revision whose snapshot checksum matches", async () => {
    const { service } = build(program());
    await expect(service.assertNcProgramUsable("tenant-a", "nc-1", "part-a", undefined, "a".repeat(64))).resolves.toMatchObject({ id: "nc-1" });
  });

  it("rejects draft, superseded and checksum-mismatched revisions before production", async () => {
    const { service } = build(program({ status: "SUPERSEDED" }));
    await expect(service.assertNcProgramUsable("tenant-a", "nc-1", "part-a")).rejects.toBeInstanceOf(ConflictException);

    const mismatched = build(program());
    await expect(mismatched.service.assertNcProgramUsable("tenant-a", "nc-1", "part-a", undefined, "b".repeat(64))).rejects.toBeInstanceOf(ConflictException);
  });

  it("does not resolve a program from another tenant or part", async () => {
    const { service, prisma } = build(null);
    await expect(service.assertNcProgramUsable("tenant-b", "nc-1", "part-b")).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.ncProgram.findFirst).toHaveBeenCalledWith({ where: { id: "nc-1", tenantId: "tenant-b", partId: "part-b" } });
  });

  it("recalculates SHA-256 from uploaded bytes instead of trusting an old checksum", async () => {
    const prisma: any = {
      ncProgram: {
        findFirst: jest.fn().mockResolvedValue({ ...program({ status: "DRAFT" }), fileName: "old.nc" }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
      },
    };
    const minio: any = { putObject: jest.fn().mockResolvedValue(undefined) };
    const service = new PartsService(prisma, minio, {} as any, {} as any);
    const updated = await service.uploadNcProgramFile("tenant-a", "nc-1", { fileName: "new.nc", mimeType: "text/plain", buffer: Buffer.from("G01 X42") });
    expect(updated.checksum).toBe("aea01059d5eaf2bc439efc7013c0821c1362b32e921df962aa8735739ad6caba");
    expect(updated.checksum).not.toBe("a".repeat(64));
  });
});
