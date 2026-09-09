import { ApprovalsService } from "./approvals.service";

describe("ApprovalsService", () => {
  function build(requestedById = "requester") {
    const prisma: any = {
      approvalRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-1", tenantId: "tenant-1", requestedById, requiredRoles: ["PLANNER"],
          status: "PENDING", entity: "capa", entityId: "capa-1",
        }),
        update: jest.fn().mockResolvedValue({ id: "approval-1", status: "APPROVED" }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
    };
    prisma.$transaction = jest.fn((callback: (client: typeof prisma) => unknown) => callback(prisma));
    const notifications = { notifyUser: jest.fn().mockResolvedValue(undefined) };
    return { service: new ApprovalsService(prisma as never, notifications as never), prisma, notifications };
  }

  it("talep sahibi kendi talebini karara bağlayamaz", async () => {
    const { service, prisma } = build("user-1");
    await expect(service.approve("tenant-1", "approval-1", "user-1", "PLANNER")).rejects.toThrow("kendi talebini");
    expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
  });

  it("atanmış farklı rol onay verebilir ve bildirim committen sonra üretilir", async () => {
    const { service, prisma, notifications } = build();
    await service.approve("tenant-1", "approval-1", "approver", "PLANNER", "kontrol edildi");
    expect(prisma.approvalRequest.update).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "STATUS_CHANGE", userId: "approver" }) }));
    expect(notifications.notifyUser).toHaveBeenCalledWith("tenant-1", "requester", expect.objectContaining({ type: "APPROVAL_GRANTED" }));
  });

  it("talep anındaki karar bağlamı için SHA-256 snapshot kanıtı yazar", async () => {
    const { service, prisma } = build();
    prisma.approvalRequest.create = jest.fn().mockResolvedValue({ id: "approval-2" });
    await service.request("tenant-1", "requester", { entity: "capa", entityId: "capa-1", requiredRoles: ["PLANNER"], note: "kontrol" });
    expect(prisma.approvalRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ requestSnapshot: expect.objectContaining({ entity: "capa", entityId: "capa-1" }), requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) }) }));
  });
});
