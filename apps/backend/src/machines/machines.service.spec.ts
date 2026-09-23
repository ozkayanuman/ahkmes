import { MachinesService } from "./machines.service";

describe("MachinesService maintenance gate", () => {
  it("does not let controller CYCLE_START bypass maintenance availability", async () => {
    const prisma = { productionRun: { findFirst: jest.fn() } };
    const maintenanceAvailability = { assertProductionAvailable: jest.fn().mockRejectedValue(new Error("MACHINE_MAINTENANCE_BLOCK")) };
    const service = new MachinesService(
      prisma as any,
      { notifyRoles: jest.fn() } as any,
      { start: jest.fn(), autoCloseOnResume: jest.fn() } as any,
      { record: jest.fn() } as any,
      maintenanceAvailability as any,
    );

    await expect(service.handleTelemetry({ id: "machine-a", tenantId: "tenant-a", activeWorkOrderId: "wo-a" } as any, { type: "CYCLE_START" } as any)).rejects.toThrow("MACHINE_MAINTENANCE_BLOCK");

    expect(maintenanceAvailability.assertProductionAvailable).toHaveBeenCalledWith("tenant-a", "machine-a");
    expect(prisma.productionRun.findFirst).not.toHaveBeenCalled();
  });

  it("grants an active tenant-scoped machine qualification with an audit trail", async () => {
    const prisma: any = {
      machine: { findFirst: jest.fn().mockResolvedValue({ id: "machine-a", tenantId: "tenant-a", operatorQualificationRequired: true }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "operator-a", tenantId: "tenant-a", isActive: true }) },
      operatorMachineQualification: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: "qualification-a", status: "ACTIVE" }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-a" }) },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    const outbox = { record: jest.fn() };
    const service = new MachinesService(
      prisma,
      { notifyRoles: jest.fn() } as any,
      { start: jest.fn(), autoCloseOnResume: jest.fn() } as any,
      outbox as any,
      { assertProductionAvailable: jest.fn() } as any,
    );

    await service.grantOperatorQualification("tenant-a", "admin-a", "machine-a", {
      operatorId: "operator-a", qualificationReference: "Eğitim-42",
    });

    expect(prisma.operatorMachineQualification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_machineId_operatorId: { tenantId: "tenant-a", machineId: "machine-a", operatorId: "operator-a" } },
      create: expect.objectContaining({ status: "ACTIVE", grantedById: "admin-a", qualificationReference: "Eğitim-42" }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entity: "operator-machine-qualifications", action: "CREATE" }) }));
    expect(outbox.record).toHaveBeenCalledWith(prisma, "tenant-a", "machine", "machine-a", "machine.updated", expect.any(Object));
  });
});
