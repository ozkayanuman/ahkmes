import { OpportunitiesService } from "./opportunities.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    opportunity: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    customer: { findFirst: jest.fn() },
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new OpportunitiesService(prisma as any);
  return { service, prisma };
}

describe("OpportunitiesService.create", () => {
  it("müşteri yoksa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(service.create("t1", { customerId: "c1", title: "Yeni fırsat" })).rejects.toThrow();
    expect(prisma.opportunity.create).not.toHaveBeenCalled();
  });
});

describe("OpportunitiesService.update", () => {
  it("stage WON'a geçince wonAt damgalar", async () => {
    const { service, prisma } = buildService();
    prisma.opportunity.findFirst.mockResolvedValue({ id: "o1", tenantId: "t1", stage: "PROPOSAL" });
    prisma.opportunity.update.mockResolvedValue({ id: "o1", stage: "WON" });

    await service.update("t1", "o1", { stage: "WON" });

    expect(prisma.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stage: "WON", wonAt: expect.any(Date) }) }),
    );
  });

  it("stage LOST'a geçince lostAt damgalar", async () => {
    const { service, prisma } = buildService();
    prisma.opportunity.findFirst.mockResolvedValue({ id: "o1", tenantId: "t1", stage: "PROPOSAL" });
    prisma.opportunity.update.mockResolvedValue({ id: "o1", stage: "LOST" });

    await service.update("t1", "o1", { stage: "LOST", lostReason: "Fiyat" });

    expect(prisma.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stage: "LOST", lostAt: expect.any(Date) }) }),
    );
  });

  it("stage değişmiyorsa wonAt/lostAt eklenmez", async () => {
    const { service, prisma } = buildService();
    prisma.opportunity.findFirst.mockResolvedValue({ id: "o1", tenantId: "t1", stage: "PROPOSAL" });
    prisma.opportunity.update.mockResolvedValue({ id: "o1" });

    await service.update("t1", "o1", { estimatedValue: 1000 });

    const call = prisma.opportunity.update.mock.calls[0][0];
    expect(call.data.wonAt).toBeUndefined();
    expect(call.data.lostAt).toBeUndefined();
  });
});
