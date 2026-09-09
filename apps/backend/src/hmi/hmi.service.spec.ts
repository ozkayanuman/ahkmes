import { ConflictException } from "@nestjs/common";
import { HmiService } from "./hmi.service";

describe("HmiService", () => {
  const prisma = {
    workOrderOperation: { findMany: jest.fn() },
    productionRun: { findFirst: jest.fn() },
    productionExecutionEvent: { findMany: jest.fn() },
    reworkRequirement: { findMany: jest.fn() },
  };
  const production = { start: jest.fn(), complete: jest.fn() };
  const workOrders = { completeOperation: jest.fn() };
  const tooling = { getSetup: jest.fn() };
  const materials = { requirements: jest.fn(), backflush: jest.fn() };
  const quality = { operationStatus: jest.fn() };
  const controllerVerification = { status: jest.fn() };
  const maintenanceAvailability = { status: jest.fn() };
  const maintenance = { createRequest: jest.fn(), declareBreakdown: jest.fn() };
  const service = new HmiService(prisma as any, production as any, workOrders as any, tooling as any, materials as any, quality as any, controllerVerification as any, maintenanceAvailability as any, maintenance as any);

  beforeEach(() => jest.clearAllMocks());

  it("delegates operator maintenance reports to the canonical CMMS service", async () => {
    maintenance.createRequest.mockResolvedValue({ id: "request-a" });
    maintenance.declareBreakdown.mockResolvedValue({ id: "breakdown-a" });

    await expect(service.createMaintenanceRequest("tenant-a", "operator-a", { machineId: "machine-a", problem: "Noise", priority: "HIGH" } as any)).resolves.toEqual({ id: "request-a" });
    await expect(service.declareMaintenanceBreakdown("tenant-a", "operator-a", { machineId: "machine-a", description: "Spindle stopped", priority: "CRITICAL" } as any)).resolves.toEqual({ id: "breakdown-a" });
    expect(maintenance.createRequest).toHaveBeenCalledWith("tenant-a", "operator-a", expect.objectContaining({ machineId: "machine-a" }));
    expect(maintenance.declareBreakdown).toHaveBeenCalledWith("tenant-a", "operator-a", expect.objectContaining({ machineId: "machine-a" }));
  });

  it("exposes maintenance availability and turns an active block into an HMI checklist blocker", async () => {
    (service as any).operation = jest.fn().mockResolvedValue({
      id: "operation-a", workOrderId: "work-order-a", seq: 10, name: "Mill", status: "PENDING", completedQty: 0, scrapQty: 0,
      startedAt: null, completedAt: null, instructionHtml: null, machineId: "machine-a", machine: { id: "machine-a", name: "CNC-A", unit: null },
      ncProgramId: null, ncProgram: null, toolRequirements: [], fixtureRequirements: [], setupVerifications: [],
      workOrder: { id: "work-order-a", woNo: "WO-A", quantity: 1, priority: 1, status: "RELEASED", dueDate: new Date(), plannedStartDate: null, plannedEndDate: null, machine: null, part: { id: "part-a", partNo: "P-A", revision: "A", name: "Part" } },
    });
    tooling.getSetup.mockResolvedValue({ operation: { toolRequirements: [], fixtureRequirements: [] }, fixtureCompliance: [] });
    prisma.productionRun.findFirst.mockResolvedValue(null);
    materials.requirements.mockResolvedValue([]);
    quality.operationStatus.mockResolvedValue({ required: false });
    prisma.productionExecutionEvent.findMany.mockResolvedValue([]);
    prisma.reworkRequirement.findMany.mockResolvedValue([]);
    controllerVerification.status.mockResolvedValue({ required: false, verification: "UNSUPPORTED" });
    maintenanceAvailability.status.mockResolvedValue({ machineId: "machine-a", maintenanceState: "BREAKDOWN", productionAllowed: false, reasonCode: "MACHINE_MAINTENANCE_BLOCK" });

    const detail = await service.detail("tenant-a", "operation-a");

    expect(detail.maintenanceAvailability).toMatchObject({ maintenanceState: "BREAKDOWN", productionAllowed: false });
    expect(detail.checklist.items).toContainEqual(expect.objectContaining({ code: "MAINTENANCE", level: "BLOCKING" }));
  });

  it("scopes the operation queue to the caller tenant", async () => {
    prisma.workOrderOperation.findMany.mockResolvedValue([]);

    await service.list("tenant-a", {});

    expect(prisma.workOrderOperation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: "tenant-a", status: { in: ["PENDING", "SETUP", "IN_PROGRESS", "PAUSED", "HELD", "REWORK", "BLOCKED"] } }),
    }));
  });

  it("MES-OPERATOR-HMI-002: operasyon kuyruğu talimatın immutable snapshot'ını (instructionHtml) döndürür", async () => {
    prisma.workOrderOperation.findMany.mockResolvedValue([{
      id: "operation-a", workOrderId: "work-order-a", seq: 1, name: "Tornalama", status: "PENDING",
      completedQty: "0", scrapQty: "0", startedAt: null, completedAt: null,
      instructionHtml: "<p>talimat</p>",
      machine: null, ncProgram: null, toolRequirements: [], fixtureRequirements: [], setupVerifications: [],
      workOrder: { machine: null },
    }]);

    const rows = await service.list("tenant-a", {});

    expect(rows[0]).toMatchObject({ instructionHtml: "<p>talimat</p>" });
  });

  it("does not silently complete an in-progress operation when its active run is absent", async () => {
    (service as any).operation = jest.fn().mockResolvedValue({ id: "operation-a", workOrderId: "work-order-a", status: "IN_PROGRESS" });
    prisma.productionRun.findFirst.mockResolvedValue(null);

    await expect(service.complete("tenant-a", "user-a", "operation-a", { goodCount: 1, scrapCount: 0 })).rejects.toBeInstanceOf(ConflictException);
    expect(production.complete).not.toHaveBeenCalled();
    expect(workOrders.completeOperation).not.toHaveBeenCalled();
  });
});
