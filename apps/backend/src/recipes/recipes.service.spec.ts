import { RecipesService } from "./recipes.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    part: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) },
    recipeHeader: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    recipeStep: { deleteMany: jest.fn(), update: jest.fn(), create: jest.fn() },
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

  it("adım iş talimatını kaydetmeden önce sanitize eder", async () => {
    const { service, prisma } = buildService();
    prisma.recipeHeader.create.mockResolvedValue({ id: "r1" });

    await service.create("t1", {
      partId: "p1",
      revision: "A",
      steps: [{ seq: 1, name: "Tornalama", instructionHtml: '<p onclick="alert(1)">talimat</p><script>x</script>' }],
    });

    const created = prisma.recipeHeader.create.mock.calls[0][0];
    const stepData = created.data.steps.create[0];
    expect(stepData.instructionHtml).toBe("<p>talimat</p>");
  });
});

describe("RecipesService.update", () => {
  it("hiç var olan adım yokken gönderilen id'siz adımlar create ile eklenir, deleteMany çağrılmaz", async () => {
    const { service, prisma } = buildService();
    prisma.recipeHeader.findFirst.mockResolvedValue({ id: "r1", partId: "p1", steps: [] });
    prisma.recipeHeader.update.mockResolvedValue({ id: "r1" });

    await service.update("t1", "r1", { steps: [{ seq: 1, name: "Yeni Adım" }] });

    expect(prisma.recipeStep.deleteMany).not.toHaveBeenCalled();
    expect(prisma.recipeStep.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: "t1", recipeHeaderId: "r1", seq: 1, name: "Yeni Adım" }),
    });
    expect(prisma.recipeHeader.update).toHaveBeenCalled();
  });

  it("id'si gönderilen var olan bir adım update ile güncellenir, silinmez/yeniden oluşturulmaz", async () => {
    const { service, prisma } = buildService();
    prisma.recipeHeader.findFirst.mockResolvedValue({ id: "r1", partId: "p1", steps: [{ id: "s1" }] });
    prisma.recipeHeader.update.mockResolvedValue({ id: "r1" });

    await service.update("t1", "r1", { steps: [{ id: "s1", seq: 1, name: "Güncellendi" }] });

    expect(prisma.recipeStep.deleteMany).not.toHaveBeenCalled();
    expect(prisma.recipeStep.create).not.toHaveBeenCalled();
    expect(prisma.recipeStep.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({ seq: 1, name: "Güncellendi" }),
    });
  });

  it("gelen listede olmayan var olan bir adım silinir", async () => {
    const { service, prisma } = buildService();
    prisma.recipeHeader.findFirst.mockResolvedValue({ id: "r1", partId: "p1", steps: [{ id: "s1" }, { id: "s2" }] });
    prisma.recipeHeader.update.mockResolvedValue({ id: "r1" });

    await service.update("t1", "r1", { steps: [{ id: "s1", seq: 1, name: "Kalan" }] });

    expect(prisma.recipeStep.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["s2"] }, recipeHeaderId: "r1" } });
  });

  it("bu reçeteye ait olmayan bir adım id'si gönderilirse reddedilir", async () => {
    const { service, prisma } = buildService();
    prisma.recipeHeader.findFirst.mockResolvedValue({ id: "r1", partId: "p1", steps: [{ id: "s1" }] });

    await expect(
      service.update("t1", "r1", { steps: [{ id: "başka-reçetenin-adımı", seq: 1, name: "X" }] }),
    ).rejects.toThrow();
    expect(prisma.recipeStep.update).not.toHaveBeenCalled();
    expect(prisma.recipeStep.create).not.toHaveBeenCalled();
  });

  it("güncellenen adımın iş talimatı kaydetmeden önce sanitize edilir", async () => {
    const { service, prisma } = buildService();
    prisma.recipeHeader.findFirst.mockResolvedValue({ id: "r1", partId: "p1", steps: [{ id: "s1" }] });
    prisma.recipeHeader.update.mockResolvedValue({ id: "r1" });

    await service.update("t1", "r1", {
      steps: [{ id: "s1", seq: 1, name: "X", instructionHtml: "<script>alert(1)</script><p>talimat</p>" }],
    });

    expect(prisma.recipeStep.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({ instructionHtml: "<p>talimat</p>" }),
    });
  });
});
