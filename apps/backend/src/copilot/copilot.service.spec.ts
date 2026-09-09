import { CopilotService } from "./copilot.service";

describe("CopilotService", () => {
  it("finds duplicate material codes and returns only safe drafts with missing fields", async () => {
    const prisma = {
      material: {
        findMany: jest.fn().mockResolvedValue([{ code: "4140", name: "4140 Çelik" }]),
      },
    };
    const service = new CopilotService(prisma as never);

    const result = await service.createDraft("tenant1", "*", {
      prompt: "4140, 6082 ve 1.2379 malzemelerini sisteme tanımla",
    });

    expect(prisma.material.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant1", code: { in: ["4140", "6082", "1.2379"] } },
    }));
    expect(result.status).toBe("DRAFT");
    expect(result.executionAllowed).toBe(false);
    expect(result.actions[0].drafts).toEqual([
      { code: "6082", name: "6082", missingFields: ["type", "unit"] },
      { code: "1.2379", name: "1.2379", missingFields: ["type", "unit"] },
    ]);
  });

  it("does not expose a command for unsupported requests", async () => {
    const prisma = { material: { findMany: jest.fn() } };
    const service = new CopilotService(prisma as never);

    const result = await service.createDraft("tenant1", "*", { prompt: "Merhaba, nasılsın?" });

    expect(result.status).toBe("NEEDS_CLARIFICATION");
    expect(result.actions).toEqual([]);
    expect(prisma.material.findMany).not.toHaveBeenCalled();
  });

  it("suggests authorized workflows across the system without enabling execution", async () => {
    const prisma = { material: { findMany: jest.fn() } };
    const service = new CopilotService(prisma as never);

    const result = await service.createDraft("tenant1", ["work-orders", "mrp"], {
      prompt: "Yeni iş emri oluşturup MRP planlamasını kontrol etmek istiyorum",
    });

    expect(result.status).toBe("SUGGESTION");
    expect(result.executionAllowed).toBe(false);
    expect(result.suggestions.map((suggestion) => suggestion.id)).toEqual(["work-order.create", "planning.mrp"]);
    expect(prisma.material.findMany).not.toHaveBeenCalled();
  });
});
