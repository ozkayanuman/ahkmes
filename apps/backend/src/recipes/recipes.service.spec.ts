import { RecipesService } from "./recipes.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    part: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) },
    recipeHeader: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    recipeStep: { deleteMany: jest.fn() },
    ...overrides,
  };
  prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new RecipesService(prisma as any);
  return { service, prisma };
}

describe("RecipesService.create", () => {
  it("parça bulunamazsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.part.findFirst.mockResolvedValue(null);

    await expect(
      service.create("t1", { partId: "missing", revision: "A", steps: [{ seq: 1, name: "Tornalama" }] }),
    ).rejects.toThrow();
  });

  it("yeni aktif reçete oluşturulunca önceki aktif revizyonlar pasife çekilir", async () => {
    const { service, prisma } = buildService();
    prisma.recipeHeader.create.mockResolvedValue({ id: "r1", isActive: true });

    await service.create("t1", { partId: "p1", revision: "B", steps: [{ seq: 1, name: "Tornalama" }] });

    expect(prisma.recipeHeader.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", partId: "p1", isActive: true },
      data: { isActive: false },
    });
    expect(prisma.recipeHeader.create).toHaveBeenCalled();
  });
});

describe("RecipesService.update", () => {
  it("steps verilirse eski adımlar silinip yenileri eklenir", async () => {
    const { service, prisma } = buildService();
    prisma.recipeHeader.findFirst.mockResolvedValue({ id: "r1", steps: [] });
    prisma.recipeHeader.update.mockResolvedValue({ id: "r1" });

    await service.update("t1", "r1", { steps: [{ seq: 1, name: "Yeni Adım" }] });

    expect(prisma.recipeStep.deleteMany).toHaveBeenCalledWith({ where: { recipeHeaderId: "r1" } });
    expect(prisma.recipeHeader.update).toHaveBeenCalled();
  });
});
