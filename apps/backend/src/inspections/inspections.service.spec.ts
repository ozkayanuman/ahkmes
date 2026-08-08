import { BadRequestException } from "@nestjs/common";
import { InspectionsService } from "./inspections.service";

// The service's persistence boundary is deliberately mocked: these tests verify
// the tenant-scoped quality-plan rules before an inspection is written.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo1" }) },
    qualityPlanCheck: { findFirst: jest.fn() },
    inspection: { findFirst: jest.fn(), create: jest.fn().mockResolvedValue({ id: "ins1" }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit1" }) },
    $transaction: jest.fn((fn) => fn(prisma)),
    ...overrides,
  };
  const outbox = { record: jest.fn() };
  const nonConformance = { create: jest.fn().mockResolvedValue({ id: "nc1" }) };
  return { service: new InspectionsService(prisma, nonConformance as any, outbox as any), prisma, outbox, nonConformance };
}

describe("InspectionsService quality plan controls", () => {
  it("rejects a plan check that requires a measurement when none is supplied", async () => {
    const { service, prisma } = buildService();
    prisma.qualityPlanCheck.findFirst.mockResolvedValue({
      checkpointName: "Diameter",
      unit: "mm",
      lowerLimit: 9.9,
      upperLimit: 10.1,
      requiresMeasurement: true,
    });

    await expect(service.create("tenant1", "user1", {
      workOrderId: "11111111-1111-4111-8111-111111111111",
      qualityPlanCheckId: "22222222-2222-4222-8222-222222222222",
      checkpointName: "Ignored client name",
      result: "PASS",
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("forces FAIL, creates an NCR, and retains the plan checkpoint when a measurement is out of tolerance", async () => {
    const { service, prisma, nonConformance, outbox } = buildService();
    prisma.qualityPlanCheck.findFirst.mockResolvedValue({
      checkpointName: "Diameter",
      unit: "mm",
      lowerLimit: 9.9,
      upperLimit: 10.1,
      requiresMeasurement: true,
    });
    prisma.inspection.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "ins1", ...data }));

    const created = await service.create("tenant1", "user1", {
      workOrderId: "11111111-1111-4111-8111-111111111111",
      qualityPlanCheckId: "22222222-2222-4222-8222-222222222222",
      checkpointName: "Ignored client name",
      measurementValue: 10.2,
      result: "PASS",
    });

    expect(nonConformance.create).toHaveBeenCalledWith("tenant1", "user1", expect.objectContaining({
      failureType: expect.stringContaining("Diameter"),
    }));
    expect(prisma.inspection.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        checkpointName: "Diameter",
        qualityPlanCheckId: "22222222-2222-4222-8222-222222222222",
        measurementUnit: "mm",
        result: "FAIL",
      }),
    }));
    expect(created.result).toBe("FAIL");
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "inspections", entityId: "ins1", action: "CREATE" }),
    }));
    expect(outbox.record).toHaveBeenCalledWith(prisma, "tenant1", "inspection", "ins1", "inspection.created", expect.objectContaining({ result: "FAIL" }));
  });
});
