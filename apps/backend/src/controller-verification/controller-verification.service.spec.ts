import { ControllerVerificationService } from "./controller-verification.service";

describe("ControllerVerificationService", () => {
  const prisma = { machine: { findFirst: jest.fn() }, machineControllerObservation: { findFirst: jest.fn() } };
  const service = new ControllerVerificationService(prisma as any);
  const machine = { controllerVerificationRequired: true, controllerFreshnessSeconds: 60 };
  const observation = (overrides: Record<string, unknown> = {}) => ({
    ingestedAt: new Date(), connectionState: "ONLINE", machineState: "IDLE", trustLevel: "CONTROLLER_VERIFIED",
    activeProgramIdentity: "P-100-A.NC", connectionGeneration: 1, alarmCode: null, alarmText: null,
    capabilities: { ACTIVE_PROGRAM_IDENTITY_READ: true, ALARM_READ: true }, ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.machine.findFirst.mockResolvedValue(machine);
    prisma.machineControllerObservation.findFirst.mockResolvedValue(observation());
  });

  it("matches a fresh trusted program identity", async () => {
    await expect(service.status("tenant-a", "machine-a", "P-100-A.NC")).resolves.toMatchObject({ required: true, verification: "MATCH" });
  });

  it("never interprets a different program as match", async () => {
    prisma.machineControllerObservation.findFirst.mockResolvedValue(observation({ activeProgramIdentity: "P-100-B.NC" }));
    await expect(service.status("tenant-a", "machine-a", "P-100-A.NC")).resolves.toMatchObject({ verification: "MISMATCH", reason: "CNC_PROGRAM_MISMATCH" });
  });

  it("fails closed for offline, stale, unverified and unsupported observations", async () => {
    prisma.machineControllerObservation.findFirst.mockResolvedValue(observation({ connectionState: "OFFLINE" }));
    await expect(service.status("tenant-a", "machine-a", "P-100-A.NC")).resolves.toMatchObject({ verification: "UNVERIFIED", reason: "CNC_OFFLINE" });
    prisma.machineControllerObservation.findFirst.mockResolvedValue(observation({ ingestedAt: new Date(Date.now() - 61_000) }));
    await expect(service.status("tenant-a", "machine-a", "P-100-A.NC")).resolves.toMatchObject({ verification: "STALE", reason: "CNC_DATA_STALE" });
    prisma.machineControllerObservation.findFirst.mockResolvedValue(observation({ trustLevel: "SIMULATED" }));
    await expect(service.status("tenant-a", "machine-a", "P-100-A.NC")).resolves.toMatchObject({ verification: "UNVERIFIED" });
    prisma.machineControllerObservation.findFirst.mockResolvedValue(observation({ capabilities: { ACTIVE_PROGRAM_IDENTITY_READ: false } }));
    await expect(service.status("tenant-a", "machine-a", "P-100-A.NC")).resolves.toMatchObject({ verification: "UNSUPPORTED" });
  });

  it("rejects a protected start rather than silently downgrading mismatch", async () => {
    prisma.machineControllerObservation.findFirst.mockResolvedValue(observation({ activeProgramIdentity: "WRONG.NC" }));
    await expectCode(service.assertOperationReady("tenant-a", { machineId: "machine-a", workOrder: { machineId: null }, ncProgramFileName: "P-100-A.NC" }, prisma as any), "CNC_PROGRAM_MISMATCH");
  });
});

async function expectCode(value: Promise<unknown>, code: string) {
  try { await value; throw new Error("Expected controller gate rejection"); }
  catch (error) { expect((error as { getResponse?: () => unknown }).getResponse?.()).toMatchObject({ errorCode: code }); }
}
