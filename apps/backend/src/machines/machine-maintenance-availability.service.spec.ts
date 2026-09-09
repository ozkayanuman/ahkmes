import { AppException } from "../common/app-exception";
import { MachineMaintenanceAvailabilityService } from "./machine-maintenance-availability.service";

describe("MachineMaintenanceAvailabilityService", () => {
  const machine = { findFirst: jest.fn() };
  const maintenanceOrder = { findFirst: jest.fn() };
  const prisma = { machine, maintenanceOrder };
  const service = new MachineMaintenanceAvailabilityService(prisma as any);

  beforeEach(() => {
    jest.clearAllMocks();
    maintenanceOrder.findFirst.mockResolvedValue(null);
  });

  it.each(["AVAILABLE", "MAINTENANCE_DUE", undefined])("keeps MES available for %s or historical machines without CMMS state", async (maintenanceState) => {
    machine.findFirst.mockResolvedValue({ id: "machine-a", maintenanceState });

    await expect(service.assertProductionAvailable("tenant-a", "machine-a", new Date("2026-08-17T10:00:00Z"))).resolves.toMatchObject({ productionAllowed: true });
  });

  it.each([
    ["BREAKDOWN", "MACHINE_MAINTENANCE_BLOCK"],
    ["PLANNED_MAINTENANCE", "MACHINE_MAINTENANCE_BLOCK"],
    ["OUT_OF_SERVICE", "MACHINE_OUT_OF_SERVICE"],
  ])("rejects %s with explicit domain code %s", async (maintenanceState, errorCode) => {
    machine.findFirst.mockResolvedValue({ id: "machine-a", maintenanceState });

    const attempt = service.assertProductionAvailable("tenant-a", "machine-a", new Date("2026-08-17T10:00:00Z"));
    await expect(attempt).rejects.toBeInstanceOf(AppException);
    await expect(attempt).rejects.toMatchObject({ response: expect.objectContaining({ errorCode }) });
  });

  it("blocks an active planned maintenance window but not a future window", async () => {
    machine.findFirst.mockResolvedValue({ id: "machine-a", maintenanceState: "AVAILABLE" });
    maintenanceOrder.findFirst
      .mockResolvedValueOnce({ id: "mwo-active" })
      .mockResolvedValueOnce(null);

    await expect(service.assertProductionAvailable("tenant-a", "machine-a", new Date("2026-08-17T10:00:00Z"))).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "MACHINE_MAINTENANCE_BLOCK" }),
    });
    await expect(service.assertProductionAvailable("tenant-a", "machine-a", new Date("2026-08-10T10:00:00Z"))).resolves.toMatchObject({ productionAllowed: true });
  });
});
