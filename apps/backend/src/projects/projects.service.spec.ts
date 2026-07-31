import { ProjectsService } from "./projects.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    project: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    projectTask: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    projectTimeEntry: { findMany: jest.fn(), create: jest.fn() },
    user: { findFirst: jest.fn() },
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new ProjectsService(prisma as any);
  return { service, prisma };
}

describe("ProjectsService.cost", () => {
  it("hourlyRate girilmiş kullanıcıların işçilik maliyetini toplar", async () => {
    const { service, prisma } = buildService();
    prisma.project.findFirst.mockResolvedValue({ id: "p1", tenantId: "t1" });
    prisma.projectTimeEntry.findMany.mockResolvedValue([
      { id: "e1", hours: "5", user: { id: "u1", name: "A", hourlyRate: "100" } },
      { id: "e2", hours: "2", user: { id: "u2", name: "B", hourlyRate: "50" } },
    ]);

    const result = await service.cost("t1", "p1");

    expect(result.laborCost).toBe(600);
    expect(result.laborCostPartial).toBe(false);
    expect(result.note).toBeUndefined();
  });

  it("hourlyRate eksik kullanıcıda partial bayrağını ve notu döner", async () => {
    const { service, prisma } = buildService();
    prisma.project.findFirst.mockResolvedValue({ id: "p1", tenantId: "t1" });
    prisma.projectTimeEntry.findMany.mockResolvedValue([
      { id: "e1", hours: "5", user: { id: "u1", name: "A", hourlyRate: null } },
    ]);

    const result = await service.cost("t1", "p1");

    expect(result.laborCost).toBe(0);
    expect(result.laborCostPartial).toBe(true);
    expect(result.note).toBeDefined();
  });

  it("proje bulunamazsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(service.cost("t1", "missing")).rejects.toThrow();
  });
});

describe("ProjectsService.createTask", () => {
  it("proje yoksa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(service.createTask("t1", "p1", { name: "Görev 1" })).rejects.toThrow();
    expect(prisma.projectTask.create).not.toHaveBeenCalled();
  });

  it("geçerli veriyle görev oluşturur", async () => {
    const { service, prisma } = buildService();
    prisma.project.findFirst.mockResolvedValue({ id: "p1", tenantId: "t1" });
    prisma.projectTask.create.mockResolvedValue({ id: "task1", name: "Görev 1", projectId: "p1" });

    const result = await service.createTask("t1", "p1", { name: "Görev 1" });

    expect(result.name).toBe("Görev 1");
    expect(prisma.projectTask.create).toHaveBeenCalledWith({
      data: { name: "Görev 1", projectId: "p1", tenantId: "t1" },
    });
  });

  it("parentTaskId başka projedense hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.project.findFirst.mockResolvedValue({ id: "p1", tenantId: "t1" });
    prisma.projectTask.findFirst.mockResolvedValue(null);

    await expect(
      service.createTask("t1", "p1", { name: "Alt görev", parentTaskId: "other-project-task" }),
    ).rejects.toThrow();
    expect(prisma.projectTask.create).not.toHaveBeenCalled();
  });
});

describe("ProjectsService.addTimeEntry", () => {
  it("görev yoksa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.projectTask.findFirst.mockResolvedValue(null);

    await expect(service.addTimeEntry("t1", "task1", "u1", { hours: 3 })).rejects.toThrow();
    expect(prisma.projectTimeEntry.create).not.toHaveBeenCalled();
  });

  it("geçerli veriyle zaman kaydı oluşturur", async () => {
    const { service, prisma } = buildService();
    prisma.projectTask.findFirst.mockResolvedValue({ id: "task1", tenantId: "t1" });
    prisma.projectTimeEntry.create.mockResolvedValue({ id: "e1", hours: 3, taskId: "task1", userId: "u1" });

    const result = await service.addTimeEntry("t1", "task1", "u1", { hours: 3 });

    expect(result.hours).toBe(3);
    expect(prisma.projectTimeEntry.create).toHaveBeenCalledWith({
      data: { hours: 3, taskId: "task1", userId: "u1", tenantId: "t1" },
    });
  });
});
