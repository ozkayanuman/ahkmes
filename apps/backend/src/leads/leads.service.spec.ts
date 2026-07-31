import { LeadsService } from "./leads.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const tx = {
    customer: { create: jest.fn() },
    lead: { update: jest.fn() },
  };
  const prisma = {
    lead: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new LeadsService(prisma as any);
  return { service, prisma, tx };
}

describe("LeadsService.convert", () => {
  it("lead'i CONVERTED yapar ve yeni bir Customer oluşturur", async () => {
    const { service, prisma, tx } = buildService();
    prisma.lead.findFirst.mockResolvedValue({
      id: "lead1",
      tenantId: "t1",
      companyName: "Acme A.Ş.",
      contactName: "Ali",
      email: "ali@acme.com",
      phone: "555",
      status: "NEW",
    });
    tx.customer.create.mockResolvedValue({ id: "cust1", name: "Acme A.Ş." });
    tx.lead.update.mockResolvedValue({ id: "lead1", status: "CONVERTED", convertedCustomerId: "cust1" });

    const result = await service.convert("t1", "lead1");

    expect(tx.customer.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", name: "Acme A.Ş.", contactName: "Ali", email: "ali@acme.com", phone: "555" },
    });
    expect(tx.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CONVERTED", convertedCustomerId: "cust1" } }),
    );
    expect(result.status).toBe("CONVERTED");
  });

  it("zaten CONVERTED bir lead'i tekrar dönüştürmeye çalışırsa hata fırlatır", async () => {
    const { service, prisma, tx } = buildService();
    prisma.lead.findFirst.mockResolvedValue({ id: "lead1", tenantId: "t1", status: "CONVERTED" });

    await expect(service.convert("t1", "lead1")).rejects.toThrow();
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it("lead bulunamazsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.lead.findFirst.mockResolvedValue(null);

    await expect(service.convert("t1", "missing")).rejects.toThrow();
  });
});

describe("LeadsService.update", () => {
  it("CONVERTED bir lead'i düzenlemeye çalışırsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.lead.findFirst.mockResolvedValue({ id: "lead1", tenantId: "t1", status: "CONVERTED" });

    await expect(service.update("t1", "lead1", { companyName: "Yeni Ad" })).rejects.toThrow();
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });
});
