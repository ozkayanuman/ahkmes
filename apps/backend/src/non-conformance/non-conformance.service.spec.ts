import { NonConformanceService } from "./non-conformance.service";
import { OutboxService } from "../outbox/outbox.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    nonConformance: { findFirst: jest.fn(), update: jest.fn() },
    approvalRequest: { findFirst: jest.fn().mockResolvedValue({ id: "ar1" }) },
    outboxEvent: { create: jest.fn() },
    $transaction: jest.fn((fn) => fn(prisma)),
    ...overrides,
  };
  const notifications = {
    notifyRoles: jest.fn().mockResolvedValue(undefined),
    notifyUser: jest.fn().mockResolvedValue(undefined),
  };
  const approvals = {
    request: jest.fn().mockResolvedValue({ id: "ar1" }),
    approve: jest.fn().mockResolvedValue({}),
    reject: jest.fn().mockResolvedValue({}),
    notifyDecision: jest.fn().mockResolvedValue(undefined),
  };
  const auth = {
    reauthenticate: jest.fn().mockResolvedValue({ userId: "u1", authSource: "LOCAL", verifiedAt: new Date("2026-01-01T00:00:00Z") }),
  };
  const outbox = new OutboxService();
  const service = new NonConformanceService(prisma as any, notifications as any, outbox, approvals as any, auth as any);
  return { service, prisma, notifications, approvals, auth, outbox };
}

describe("NonConformanceService.requestDeviation", () => {
  it("actionType DEVIATION olmayan bir NCR'de reddedilir", async () => {
    const { service, prisma } = buildService();
    prisma.nonConformance.findFirst.mockResolvedValue({ id: "nc1", status: "OPEN", actionType: "SCRAP" });

    await expect(service.requestDeviation("t1", "u1", "nc1")).rejects.toThrow();
  });

  it("OPEN olmayan bir DEVIATION NCR'de reddedilir", async () => {
    const { service, prisma } = buildService();
    prisma.nonConformance.findFirst.mockResolvedValue({ id: "nc1", status: "RESOLVED", actionType: "DEVIATION" });

    await expect(service.requestDeviation("t1", "u1", "nc1")).rejects.toThrow();
  });

  it("uygun bir NCR için ApprovalRequest oluşturur ve PENDING_DEVIATION_APPROVAL'a geçirir", async () => {
    const { service, prisma, approvals } = buildService();
    prisma.nonConformance.findFirst.mockResolvedValue({ id: "nc1", status: "OPEN", actionType: "DEVIATION" });
    prisma.nonConformance.update.mockResolvedValue({ id: "nc1", status: "PENDING_DEVIATION_APPROVAL" });

    const updated = await service.requestDeviation("t1", "u1", "nc1");

    expect(approvals.request).toHaveBeenCalledWith("t1", "u1", {
      entity: "non-conformance",
      entityId: "nc1",
      requiredRoles: ["ADMIN"],
    }, prisma);
    expect(updated.status).toBe("PENDING_DEVIATION_APPROVAL");
  });
});

describe("NonConformanceService.decideDeviation", () => {
  it("onaylanınca reauth ister ve status OPEN'a döner", async () => {
    const { service, prisma, approvals, auth } = buildService();
    prisma.nonConformance.findFirst.mockResolvedValue({ id: "nc1", status: "PENDING_DEVIATION_APPROVAL" });
    prisma.nonConformance.update.mockResolvedValue({ id: "nc1", status: "OPEN" });

    const updated = await service.decideDeviation("t1", "nc1", "u1", "ADMIN", "approve", undefined, "Sifre123!");

    expect(auth.reauthenticate).toHaveBeenCalledWith("t1", "u1", "Sifre123!");
    expect(approvals.approve).toHaveBeenCalledWith(
      "t1", "ar1", "u1", "ADMIN", undefined, prisma, false,
      { userId: "u1", authSource: "LOCAL", verifiedAt: new Date("2026-01-01T00:00:00Z") },
    );
    expect(updated.status).toBe("OPEN");
  });

  it("PENDING_DEVIATION_APPROVAL olmayan bir NCR'de reddedilir", async () => {
    const { service, prisma } = buildService();
    prisma.nonConformance.findFirst.mockResolvedValue({ id: "nc1", status: "OPEN" });

    await expect(service.decideDeviation("t1", "nc1", "u1", "ADMIN", "approve", undefined, "Sifre123!")).rejects.toThrow();
  });
});

describe("NonConformanceService.resolve — deviation kapısı", () => {
  it("DEVIATION actionType'lı, onaylanmamış bir NCR kapatılamaz", async () => {
    const { service, prisma } = buildService();
    prisma.nonConformance.findFirst.mockResolvedValue({ id: "nc1", actionType: "DEVIATION", workOrderId: "wo1" });
    prisma.approvalRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.resolve("t1", "u1", "nc1", { status: "RESOLVED", resolutionNote: "not" }),
    ).rejects.toThrow();
  });

  it("DEVIATION actionType'lı, onaylanmış bir NCR kapatılabilir", async () => {
    const { service, prisma } = buildService();
    prisma.nonConformance.findFirst.mockResolvedValue({ id: "nc1", actionType: "DEVIATION", workOrderId: "wo1" });
    prisma.approvalRequest.findFirst.mockResolvedValue({ id: "ar1", status: "APPROVED" });
    prisma.nonConformance.update.mockResolvedValue({ id: "nc1", status: "RESOLVED" });

    const updated = await service.resolve("t1", "u1", "nc1", { status: "RESOLVED", resolutionNote: "deviation kabul edildi" });

    expect(updated.status).toBe("RESOLVED");
  });

  it("DEVIATION olmayan bir NCR onay kontrolüne tabi değildir", async () => {
    const { service, prisma } = buildService();
    prisma.nonConformance.findFirst.mockResolvedValue({ id: "nc1", actionType: "SCRAP", workOrderId: "wo1" });
    prisma.nonConformance.update.mockResolvedValue({ id: "nc1", status: "RESOLVED" });

    const updated = await service.resolve("t1", "u1", "nc1", { status: "RESOLVED", resolutionNote: "hurdaya ayrıldı" });

    expect(updated.status).toBe("RESOLVED");
    expect(prisma.approvalRequest.findFirst).not.toHaveBeenCalled();
  });
});
