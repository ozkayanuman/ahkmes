import { ConflictException, NotFoundException } from "@nestjs/common";
import { BomService } from "./bom.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPrismaMock(overrides: any = {}) {
  const tx = {
    bomHeader: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: "bom-new" }),
      update: jest.fn().mockResolvedValue({ id: "bom-new" }),
    },
    bomLine: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  return {
    part: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }), findMany: jest.fn().mockResolvedValue([]) },
    material: { findMany: jest.fn().mockResolvedValue([]) },
    bomHeader: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    bomLine: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    ...overrides,
  };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new BomService(prisma as any);
}

describe("BomService — çok seviyeli (alt montaj) BOM doğrulaması", () => {
  it("sadece Material satırlarından oluşan BOM'u kabul eder (geriye dönük uyumluluk)", async () => {
    const prisma = buildPrismaMock({
      material: { findMany: jest.fn().mockResolvedValue([{ id: "m1" }]) },
    });
    const service = buildService(prisma);
    await expect(
      service.create("t1", {
        partId: "p1",
        revision: "A",
        lines: [{ itemType: "MATERIAL", itemId: "m1", qtyPer: "2" }],
      } as never),
    ).resolves.toBeDefined();
  });

  it("bir parça kendi ürün ağacında doğrudan alt montaj olamaz (self-reference reddi)", async () => {
    const prisma = buildPrismaMock({
      part: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }), findMany: jest.fn().mockResolvedValue([{ id: "p1" }]) },
    });
    const service = buildService(prisma);
    await expect(
      service.create("t1", {
        partId: "p1",
        revision: "A",
        lines: [{ itemType: "PART", itemId: "p1", qtyPer: "1" }],
      } as never),
    ).rejects.toThrow(ConflictException);
  });

  it("dolaylı döngü reddedilir: P1'in yeni BOM'u P2'yi alt montaj yapıyor, P2'nin aktif BOM'u zaten P1'i alt montaj olarak içeriyor", async () => {
    const prisma = buildPrismaMock({
      part: {
        findFirst: jest.fn().mockResolvedValue({ id: "p1" }),
        findMany: jest.fn().mockResolvedValue([{ id: "p2" }]),
      },
      bomHeader: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: { partId: string } }) => {
          if (where.partId === "p2") {
            return Promise.resolve({
              id: "bom-p2",
              partId: "p2",
              lines: [{ itemType: "PART", itemId: "p1" }],
            });
          }
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const service = buildService(prisma);
    await expect(
      service.create("t1", {
        partId: "p1",
        revision: "A",
        lines: [{ itemType: "PART", itemId: "p2", qtyPer: "1" }],
      } as never),
    ).rejects.toThrow(ConflictException);
  });

  it("var olmayan alt montaj parçası 404 döner", async () => {
    const prisma = buildPrismaMock({
      part: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }), findMany: jest.fn().mockResolvedValue([]) },
    });
    const service = buildService(prisma);
    await expect(
      service.create("t1", {
        partId: "p1",
        revision: "A",
        lines: [{ itemType: "PART", itemId: "p-missing", qtyPer: "1" }],
      } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it("karışık (Material + Part) satırları döngü yoksa kabul eder", async () => {
    const prisma = buildPrismaMock({
      material: { findMany: jest.fn().mockResolvedValue([{ id: "m1" }]) },
      part: {
        findFirst: jest.fn().mockResolvedValue({ id: "p1" }),
        findMany: jest.fn().mockResolvedValue([{ id: "p2" }]),
      },
      bomHeader: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const service = buildService(prisma);
    await expect(
      service.create("t1", {
        partId: "p1",
        revision: "A",
        lines: [
          { itemType: "MATERIAL", itemId: "m1", qtyPer: "2" },
          { itemType: "PART", itemId: "p2", qtyPer: "1" },
        ],
      } as never),
    ).resolves.toBeDefined();
  });
});
