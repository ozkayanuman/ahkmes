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
});
