import { ConflictException, NotFoundException } from "@nestjs/common";
import { CopilotService } from "./copilot.service";

describe("CopilotService", () => {
  it("finds duplicate material codes, returns only safe drafts, and persists a PENDING_APPROVAL draft", async () => {
    const prisma: any = {
      material: {
        findMany: jest.fn().mockResolvedValue([{ code: "4140", name: "4140 Çelik" }]),
      },
      copilotDraft: {
        create: jest.fn().mockResolvedValue({ id: "draft-a", status: "PENDING_APPROVAL" }),
      },
    };
    const service = new CopilotService(prisma);

    const result = await service.createDraft("tenant1", "*", {
      prompt: "4140, 6082 ve 1.2379 malzemelerini sisteme tanımla",
    }, "user-a");

    expect(prisma.material.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant1", code: { in: ["4140", "6082", "1.2379"] } },
    }));
    expect(result.status).toBe("DRAFT");
    expect(result.executionAllowed).toBe(false);
    expect(result.actions[0].drafts).toEqual([
      { code: "6082", name: "6082", missingFields: ["type", "unit"] },
      { code: "1.2379", name: "1.2379", missingFields: ["type", "unit"] },
    ]);
    expect(prisma.copilotDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "tenant1", status: "PENDING_APPROVAL", createdById: "user-a" }),
    }));
    expect(result.draftId).toBe("draft-a");
    expect(result.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("does not expose a command for unsupported requests, and persists it as NOT_APPROVABLE", async () => {
    const prisma: any = { material: { findMany: jest.fn() }, copilotDraft: { create: jest.fn().mockResolvedValue({ id: "draft-b", status: "NOT_APPROVABLE" }) } };
    const service = new CopilotService(prisma);

    const result = await service.createDraft("tenant1", "*", { prompt: "Merhaba, nasılsın?" }, "user-a");

    expect(result.status).toBe("NEEDS_CLARIFICATION");
    expect(result.actions).toEqual([]);
    expect(prisma.material.findMany).not.toHaveBeenCalled();
    expect(prisma.copilotDraft.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "NOT_APPROVABLE" }) }));
  });

  it("suggests authorized workflows across the system without enabling execution", async () => {
    const prisma: any = { material: { findMany: jest.fn() }, copilotDraft: { create: jest.fn().mockResolvedValue({ id: "draft-c", status: "NOT_APPROVABLE" }) } };
    const service = new CopilotService(prisma);

    const result = await service.createDraft("tenant1", ["work-orders", "mrp"], {
      prompt: "Yeni iş emri oluşturup MRP planlamasını kontrol etmek istiyorum",
    }, "user-a");

    expect(result.status).toBe("SUGGESTION");
    expect(result.executionAllowed).toBe(false);
    expect(result.suggestions.map((suggestion) => suggestion.id)).toEqual(["work-order.create", "planning.mrp"]);
    expect(prisma.material.findMany).not.toHaveBeenCalled();
  });

  it("approves a PENDING_APPROVAL draft but rejects approving a draft in any other state", async () => {
    const prisma: any = {
      copilotDraft: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: "draft-a", status: "APPROVED" }),
      },
    };
    const service = new CopilotService(prisma);

    prisma.copilotDraft.findFirst.mockResolvedValueOnce({ id: "draft-a", tenantId: "tenant1", status: "PENDING_APPROVAL" });
    await service.approveDraft("tenant1", "admin-a", "draft-a");
    expect(prisma.copilotDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "draft-a" }, data: expect.objectContaining({ status: "APPROVED", approvedById: "admin-a" }),
    }));

    prisma.copilotDraft.findFirst.mockResolvedValueOnce({ id: "draft-b", tenantId: "tenant1", status: "APPROVED" });
    await expect(service.approveDraft("tenant1", "admin-a", "draft-b")).rejects.toBeInstanceOf(ConflictException);

    prisma.copilotDraft.findFirst.mockResolvedValueOnce(null);
    await expect(service.approveDraft("tenant1", "admin-a", "missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects a PENDING_APPROVAL draft", async () => {
    const prisma: any = {
      copilotDraft: {
        findFirst: jest.fn().mockResolvedValue({ id: "draft-a", tenantId: "tenant1", status: "PENDING_APPROVAL" }),
        update: jest.fn().mockResolvedValue({ id: "draft-a", status: "REJECTED" }),
      },
    };
    const service = new CopilotService(prisma);

    await service.rejectDraft("tenant1", "admin-a", "draft-a");

    expect(prisma.copilotDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "draft-a" }, data: expect.objectContaining({ status: "REJECTED", rejectedById: "admin-a" }),
    }));
  });
});
