import { OpportunitiesService } from "./opportunities.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    opportunity: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      groupBy: jest.fn(),
    },
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

describe("OpportunitiesService.pipelineSummary", () => {
  it("her aşama için sayı/toplam döner, veri olmayan aşamalarda 0/null verir", async () => {
    const { service, prisma } = buildService();
    prisma.opportunity.groupBy.mockResolvedValue([
      { stage: "NEW", _count: { _all: 2 }, _sum: { estimatedValue: 5000 } },
      { stage: "WON", _count: { _all: 1 }, _sum: { estimatedValue: 3000 } },
    ]);

    const result = await service.pipelineSummary("t1");

    expect(result.byStage).toEqual([
      { stage: "NEW", count: 2, totalValue: 5000 },
      { stage: "QUALIFIED", count: 0, totalValue: null },
      { stage: "PROPOSAL", count: 0, totalValue: null },
      { stage: "WON", count: 1, totalValue: 3000 },
      { stage: "LOST", count: 0, totalValue: null },
    ]);
  });

  it("açık toplam (openTotalValue) sadece NEW/QUALIFIED/PROPOSAL toplamıdır, WON/LOST dahil edilmez", async () => {
    const { service, prisma } = buildService();
    prisma.opportunity.groupBy.mockResolvedValue([
      { stage: "NEW", _count: { _all: 1 }, _sum: { estimatedValue: 1000 } },
      { stage: "QUALIFIED", _count: { _all: 1 }, _sum: { estimatedValue: 2000 } },
      { stage: "WON", _count: { _all: 1 }, _sum: { estimatedValue: 9000 } },
      { stage: "LOST", _count: { _all: 1 }, _sum: { estimatedValue: 4000 } },
    ]);

    const result = await service.pipelineSummary("t1");

    expect(result.openTotalValue).toBe(3000);
  });
});
