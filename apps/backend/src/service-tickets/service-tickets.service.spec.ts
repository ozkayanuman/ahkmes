import { ServiceTicketsService } from "./service-tickets.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    serviceTicket: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    customer: { findFirst: jest.fn() },
    ...overrides,
  };
  const realtime = { emitToTenant: jest.fn() };
  const notifications = { notifyRoles: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new ServiceTicketsService(prisma as any, realtime as any, notifications as any);
  return { service, prisma, realtime, notifications };
}

describe("ServiceTicketsService.create", () => {
  it("müşteri yoksa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(service.create("t1", "u1", { customerId: "c1", subject: "Arıza" })).rejects.toThrow();
    expect(prisma.serviceTicket.create).not.toHaveBeenCalled();
  });

  it("geçerli veriyle talep oluşturur, realtime yayınlar ve ADMIN/SALES'e bildirim gönderir", async () => {
    const { service, prisma, realtime, notifications } = buildService();
    prisma.customer.findFirst.mockResolvedValue({ id: "c1", name: "Acme" });
    prisma.serviceTicket.create.mockResolvedValue({ id: "t1", subject: "Arıza", customerId: "c1" });

    await service.create("t1", "u1", { customerId: "c1", subject: "Arıza" });

    expect(realtime.emitToTenant).toHaveBeenCalledWith("t1", "serviceticket.updated", expect.any(Object));
    expect(notifications.notifyRoles).toHaveBeenCalledWith(
      "t1",
      ["ADMIN", "SALES"],
      expect.objectContaining({ type: "SERVICE_TICKET_CREATED" }),
    );
  });
});

describe("ServiceTicketsService.resolve", () => {
  it("çözüm notu olmadan RESOLVED'a geçmeye çalışırsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.serviceTicket.findFirst.mockResolvedValue({
      id: "t1",
      tenantId: "t1",
      status: "OPEN",
      resolutionNote: null,
      resolvedAt: null,
      customerId: "c1",
    });

    await expect(service.resolve("t1", "t1", { status: "RESOLVED" })).rejects.toThrow();
    expect(prisma.serviceTicket.update).not.toHaveBeenCalled();
  });

  it("çözüm notuyla RESOLVED'a geçer ve resolvedAt damgalar", async () => {
    const { service, prisma, realtime } = buildService();
    prisma.serviceTicket.findFirst.mockResolvedValue({
      id: "t1",
      tenantId: "t1",
      status: "OPEN",
      resolutionNote: null,
      resolvedAt: null,
      customerId: "c1",
    });
    prisma.serviceTicket.update.mockResolvedValue({ id: "t1", status: "RESOLVED" });

    await service.resolve("t1", "t1", { status: "RESOLVED", resolutionNote: "Parça değiştirildi" });

    expect(prisma.serviceTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RESOLVED", resolutionNote: "Parça değiştirildi", resolvedAt: expect.any(Date) }),
      }),
    );
    expect(realtime.emitToTenant).toHaveBeenCalledWith("t1", "serviceticket.updated", expect.any(Object));
  });

  it("zaten çözümlü bir talep RESOLVED→CLOSED geçişinde yeni not istemez", async () => {
    const { service, prisma } = buildService();
    const resolvedAt = new Date("2026-01-01");
    prisma.serviceTicket.findFirst.mockResolvedValue({
      id: "t1",
      tenantId: "t1",
      status: "RESOLVED",
      resolutionNote: "Zaten çözüldü",
      resolvedAt,
      customerId: "c1",
    });
    prisma.serviceTicket.update.mockResolvedValue({ id: "t1", status: "CLOSED" });

    await service.resolve("t1", "t1", { status: "CLOSED" });

    expect(prisma.serviceTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CLOSED", resolutionNote: "Zaten çözüldü" }) }),
    );
  });
});
