import { SupplierMaterialsService } from "./supplier-materials.service";

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: "sup1", tenantId: "t1" }) },
    material: { findFirst: jest.fn().mockResolvedValue({ id: "mat1", tenantId: "t1" }) },
    supplierMaterial: {
      findUnique: jest.fn().mockResolvedValue({ id: "link1", isPreferred: true, leadTimeDays: 3, unitCost: "10" }),
      findFirst: jest.fn().mockResolvedValue({ id: "link1", tenantId: "t1", supplierId: "sup1", materialId: "mat1" }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({ id: "link1", supplierId: "sup1", materialId: "mat1", isPreferred: true }),
      delete: jest.fn().mockResolvedValue({ id: "link1" }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit1" }) },
    $transaction: jest.fn(),
    ...overrides,
  };
  if (!prisma.$transaction.getMockImplementation()) prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  return prisma;
}

describe("SupplierMaterialsService", () => {
  it("keeps omitted fields and audits an update", async () => {
    const prisma = buildPrisma();
    const service = new SupplierMaterialsService(prisma as never);

    await service.upsert("t1", "user1", "sup1", { materialId: "mat1", leadTimeDays: 7 });

    expect(prisma.supplierMaterial.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { leadTimeDays: 7 } }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "t1", userId: "user1", entity: "supplier-material", action: "UPDATE" }),
    }));
  });

  it("clears other preferred suppliers before setting a new preference", async () => {
    const prisma = buildPrisma();
    const service = new SupplierMaterialsService(prisma as never);

    await service.upsert("t1", "user1", "sup1", { materialId: "mat1", isPreferred: true });

    expect(prisma.supplierMaterial.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", materialId: "mat1", NOT: { supplierId: "sup1" } },
      data: { isPreferred: false },
    });
  });

  it("returns a source only when every material shares it", async () => {
    const prisma = buildPrisma({
      supplierMaterial: { findMany: jest.fn().mockImplementation(({ where }) => Promise.resolve(
        where.materialId.in.includes("mat2")
          ? [{ materialId: "mat1", supplierId: "sup1" }, { materialId: "mat2", supplierId: "sup1" }]
          : [{ materialId: "mat1", supplierId: "sup1" }],
      )) },
    });
    const service = new SupplierMaterialsService(prisma as never);

    await expect(service.findCommonPreferredSupplier("t1", ["mat1", "mat1", "mat2"])).resolves.toBe("sup1");
    await expect(service.findCommonPreferredSupplier("t1", ["mat1", "mat3"])).resolves.toBeNull();
  });
});
