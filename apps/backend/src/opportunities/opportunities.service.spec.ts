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
    opportunityActivity: { findMany: jest.fn(), create: jest.fn() },
    customer: { findFirst: jest.fn() },
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  const outbox = { record: jest.fn() };
  const service = new OpportunitiesService(prisma as any, outbox as any);
  return { service, prisma, outbox };
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
      expect.objectContaining({ data: expect.objectContaining({ stage: "WON", wonAt: expect.any(Date), nextFollowUpAt: null }) }),
    );
  });

  it("stage LOST'a geçince lostAt damgalar", async () => {
    const { service, prisma } = buildService();
    prisma.opportunity.findFirst.mockResolvedValue({ id: "o1", tenantId: "t1", stage: "PROPOSAL" });
    prisma.opportunity.update.mockResolvedValue({ id: "o1", stage: "LOST" });

    await service.update("t1", "o1", { stage: "LOST", lostReason: "Fiyat" });

    expect(prisma.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stage: "LOST", lostAt: expect.any(Date), nextFollowUpAt: null }) }),
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

describe("OpportunitiesService.activities", () => {
  it("timeline yalnızca aynı tenant fırsatı için döner", async () => {
    const { service, prisma } = buildService();
    prisma.opportunity.findFirst.mockResolvedValue({ id: "o1", tenantId: "t1" });
    prisma.opportunityActivity.findMany.mockResolvedValue([]);

    await service.listActivities("t1", "o1");

    expect(prisma.opportunityActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "t1", opportunityId: "o1" } }),
    );
  });

  it("aktivite ve takip tarihini tek transaction içinde kaydedip outbox'a yazar", async () => {
    const { service, prisma, outbox } = buildService();
    prisma.opportunity.findFirst.mockResolvedValue({ id: "o1", tenantId: "t1", stage: "PROPOSAL" });
    prisma.opportunityActivity.create.mockResolvedValue({ id: "a1", type: "CALL" });
    prisma.opportunity.update.mockResolvedValue({ id: "o1" });

    await service.createActivity("t1", "o1", "u1", {
      type: "CALL", note: "Teklif görüşüldü", nextFollowUpAt: new Date("2026-10-01T09:00:00.000Z"),
    });

    expect(prisma.opportunityActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "t1", opportunityId: "o1", authorId: "u1", type: "CALL" }),
    }));
    expect(prisma.opportunity.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { nextFollowUpAt: new Date("2026-10-01T09:00:00.000Z") },
    }));
    expect(outbox.record).toHaveBeenCalledWith(prisma, "t1", "opportunity", "o1", "opportunity.activity-recorded", {
      activityId: "a1", type: "CALL",
    });
  });

  it("null takip tarihi eski pipeline hatırlatıcısını temizler", async () => {
    const { service, prisma } = buildService();
    prisma.opportunity.findFirst.mockResolvedValue({ id: "o1", tenantId: "t1", stage: "PROPOSAL" });
    prisma.opportunityActivity.create.mockResolvedValue({ id: "a1", type: "NOTE" });
    prisma.opportunity.update.mockResolvedValue({ id: "o1" });

    await service.createActivity("t1", "o1", "u1", { type: "NOTE", note: "Takip tamamlandı", nextFollowUpAt: null });

    expect(prisma.opportunity.update).toHaveBeenCalledWith(expect.objectContaining({ data: { nextFollowUpAt: null } }));
  });
});
