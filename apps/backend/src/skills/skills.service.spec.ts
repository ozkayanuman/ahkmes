import { SkillsService } from "./skills.service";

describe("SkillsService", () => {
  it("grants an operator skill with an audit trail", async () => {
    const prisma: any = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "operator-a", tenantId: "tenant-a", isActive: true }) },
      skill: { findFirst: jest.fn().mockResolvedValue({ id: "skill-a", tenantId: "tenant-a", code: "CNC-5AX" }) },
      operatorSkill: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: "grant-a", status: "ACTIVE", level: "QUALIFIED" }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-a" }) },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    const outbox = { record: jest.fn() };
    const service = new SkillsService(prisma, outbox as any);

    await service.grantOperatorSkill("tenant-a", "admin-a", {
      operatorId: "operator-a", skillId: "skill-a", level: "QUALIFIED",
    });

    expect(prisma.operatorSkill.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_operatorId_skillId: { tenantId: "tenant-a", operatorId: "operator-a", skillId: "skill-a" } },
      create: expect.objectContaining({ status: "ACTIVE", level: "QUALIFIED", grantedById: "admin-a" }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entity: "operator-skills", action: "CREATE" }) }));
  });

  it("finds no missing skills when a machine has no requirements", async () => {
    const prisma: any = { machineRequiredSkill: { findMany: jest.fn().mockResolvedValue([]) }, operatorSkill: { findMany: jest.fn() } };
    const service = new SkillsService(prisma, { record: jest.fn() } as any);

    const missing = await service.findMissingSkills("tenant-a", "machine-a", "operator-a");

    expect(missing).toEqual([]);
    expect(prisma.operatorSkill.findMany).not.toHaveBeenCalled();
  });

  it("flags a missing skill when the operator's grant level is below the machine's required minLevel", async () => {
    const prisma: any = {
      machineRequiredSkill: {
        findMany: jest.fn().mockResolvedValue([
          { skillId: "skill-a", minLevel: "EXPERT", skill: { code: "CNC-5AX", name: "5 Eksen Freze" } },
          { skillId: "skill-b", minLevel: "TRAINEE", skill: { code: "CNC-TURN", name: "Tornalama" } },
        ]),
      },
      operatorSkill: {
        findMany: jest.fn().mockResolvedValue([
          { skillId: "skill-a", level: "QUALIFIED" },
          { skillId: "skill-b", level: "EXPERT" },
        ]),
      },
    };
    const service = new SkillsService(prisma, { record: jest.fn() } as any);

    const missing = await service.findMissingSkills("tenant-a", "machine-a", "operator-a");

    expect(missing).toHaveLength(1);
    expect(missing[0].skillId).toBe("skill-a");
  });

  it("flags a missing skill when the operator has no grant at all for a required skill", async () => {
    const prisma: any = {
      machineRequiredSkill: {
        findMany: jest.fn().mockResolvedValue([{ skillId: "skill-a", minLevel: "TRAINEE", skill: { code: "CNC-5AX", name: "5 Eksen Freze" } }]),
      },
      operatorSkill: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new SkillsService(prisma, { record: jest.fn() } as any);

    const missing = await service.findMissingSkills("tenant-a", "machine-a", "operator-a");

    expect(missing).toHaveLength(1);
  });
});
