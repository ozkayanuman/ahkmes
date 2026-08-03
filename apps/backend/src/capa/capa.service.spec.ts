import { CapaService } from "./capa.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    capa: { findFirst: jest.fn(), update: jest.fn() },
    approvalRequest: { findFirst: jest.fn().mockResolvedValue({ id: "ar1" }) },
    nonConformance: { findFirst: jest.fn().mockResolvedValue({ id: "nc1" }) },
    $transaction: jest.fn((fn) => fn(prisma)),
    ...overrides,
  };
  const realtime = { emitToTenant: jest.fn() };
  const approvals = {
    request: jest.fn().mockResolvedValue({ id: "ar1" }),
    approve: jest.fn().mockResolvedValue({}),
    reject: jest.fn().mockResolvedValue({}),
    notifyDecision: jest.fn().mockResolvedValue(undefined),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new CapaService(prisma as any, realtime as any, approvals as any);
  return { service, prisma, realtime, approvals };
}

describe("CapaService.submitForApproval", () => {
  it("DRAFT olmayan CAPA onaya gönderilemez", async () => {
    const { service, prisma } = buildService();
    prisma.capa.findFirst.mockResolvedValue({ id: "c1", status: "APPROVED" });

    await expect(service.submitForApproval("t1", "u1", "c1")).rejects.toThrow();
  });

  it("DRAFT CAPA onaya gönderilir", async () => {
    const { service, prisma, approvals } = buildService();
    prisma.capa.findFirst.mockResolvedValue({ id: "c1", status: "DRAFT" });
    prisma.capa.update.mockResolvedValue({ id: "c1", status: "PENDING_APPROVAL" });

    const updated = await service.submitForApproval("t1", "u1", "c1");

    expect(approvals.request).toHaveBeenCalledWith("t1", "u1", {
      entity: "capa",
      entityId: "c1",
      requiredRoles: ["ADMIN"],
    }, prisma);
    expect(updated.status).toBe("PENDING_APPROVAL");
  });
});

describe("CapaService.decide", () => {
  it("onaylanınca status APPROVED olur", async () => {
    const { service, prisma, approvals } = buildService();
    prisma.capa.findFirst.mockResolvedValue({ id: "c1", status: "PENDING_APPROVAL" });
    prisma.capa.update.mockResolvedValue({ id: "c1", status: "APPROVED" });

    const updated = await service.decide("t1", "c1", "u1", "ADMIN", "approve");

    expect(approvals.approve).toHaveBeenCalledWith("t1", "ar1", "u1", "ADMIN", undefined, prisma, false);
    expect(updated.status).toBe("APPROVED");
  });

  it("reddedilince status REJECTED olur", async () => {
    const { service, prisma, approvals } = buildService();
    prisma.capa.findFirst.mockResolvedValue({ id: "c1", status: "PENDING_APPROVAL" });
    prisma.capa.update.mockResolvedValue({ id: "c1", status: "REJECTED" });

    const updated = await service.decide("t1", "c1", "u1", "ADMIN", "reject", "yetersiz kanıt");

    expect(approvals.reject).toHaveBeenCalledWith("t1", "ar1", "u1", "ADMIN", "yetersiz kanıt", prisma, false);
    expect(updated.status).toBe("REJECTED");
  });
});

describe("CapaService.close", () => {
  it("APPROVED olmayan CAPA kapatılamaz", async () => {
    const { service, prisma } = buildService();
    prisma.capa.findFirst.mockResolvedValue({ id: "c1", status: "DRAFT" });

    await expect(service.close("t1", "c1")).rejects.toThrow();
  });

  it("APPROVED CAPA kapatılır", async () => {
    const { service, prisma } = buildService();
    prisma.capa.findFirst.mockResolvedValue({ id: "c1", status: "APPROVED" });
    prisma.capa.update.mockResolvedValue({ id: "c1", status: "CLOSED" });

    const updated = await service.close("t1", "c1");

    expect(updated.status).toBe("CLOSED");
  });
});
