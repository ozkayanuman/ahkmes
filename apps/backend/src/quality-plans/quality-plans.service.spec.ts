import { QualityPlansService } from "./quality-plans.service";

describe("QualityPlansService revisions", () => {
  it("aktif planın kontrollerini yeni revizyona kopyalar, kaynağı pasifleştirir ve iki audit yazar", async () => {
    const created = { id: "plan-b", name: "İlk parça", revision: "B", checks: [{ id: "new-check", seq: 1 }] };
    const tx = {
      qualityPlan: {
        findFirst: jest.fn().mockResolvedValue({
          status: "RELEASED",
          id: "plan-a", tenantId: "t1", name: "İlk parça", revision: "A", partId: "part-1", isActive: true,
          checks: [{ id: "old-check", seq: 1, checkpointName: "Çap", operationSeq: 10, unit: "mm", lowerLimit: "9.9", upperLimit: "10.1", requiresMeasurement: true }],
        }),
        create: jest.fn().mockResolvedValue(created), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({ id: "plan-a", isActive: false }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit" }) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new QualityPlansService(prisma as any);

    await expect(service.createRevision("t1", "u1", "plan-a", { revision: "B" })).resolves.toEqual(created);
    expect(tx.qualityPlan.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revision: "B", checks: expect.objectContaining({ create: [expect.objectContaining({ checkpointName: "Çap", seq: 1 })] }) }) }));
    expect(tx.qualityPlan.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
