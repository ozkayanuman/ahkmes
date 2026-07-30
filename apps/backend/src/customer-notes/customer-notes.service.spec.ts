import { CustomerNotesService } from "./customer-notes.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    customer: { findFirst: jest.fn() },
    customerNote: { findMany: jest.fn(), create: jest.fn() },
    ...overrides,
  };
  const realtime = { emitToTenant: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new CustomerNotesService(prisma as any, realtime as any);
  return { service, prisma, realtime };
}

describe("CustomerNotesService", () => {
  it("list: müşteri bulunamazsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(service.list("t1", "c1")).rejects.toThrow();
    expect(prisma.customerNote.findMany).not.toHaveBeenCalled();
  });

  it("list: müşteri notlarını döner", async () => {
    const { service, prisma } = buildService();
    prisma.customer.findFirst.mockResolvedValue({ id: "c1" });
    prisma.customerNote.findMany.mockResolvedValue([{ id: "n1", note: "aradı" }]);

    const notes = await service.list("t1", "c1");

    expect(prisma.customerNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "t1", customerId: "c1" } }),
    );
    expect(notes).toHaveLength(1);
  });

  it("create: müşteri bulunamazsa not oluşturmaz", async () => {
    const { service, prisma } = buildService();
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(service.create("t1", "c1", "u1", { note: "test" })).rejects.toThrow();
    expect(prisma.customerNote.create).not.toHaveBeenCalled();
  });

  it("create: notu kaydeder ve realtime yayınlar", async () => {
    const { service, prisma, realtime } = buildService();
    prisma.customer.findFirst.mockResolvedValue({ id: "c1" });
    prisma.customerNote.create.mockResolvedValue({ id: "n1", note: "aradı" });

    const created = await service.create("t1", "c1", "u1", { note: "aradı" });

    expect(prisma.customerNote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tenantId: "t1", customerId: "c1", authorId: "u1", note: "aradı" } }),
    );
    expect(created.id).toBe("n1");
    expect(realtime.emitToTenant).toHaveBeenCalledWith("t1", "customernote.created", {
      customerId: "c1",
      id: "n1",
    });
  });
});
