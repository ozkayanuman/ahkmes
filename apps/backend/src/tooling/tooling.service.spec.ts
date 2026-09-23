import { ConflictException } from "@nestjs/common";
import { ToolingService } from "./tooling.service";

describe("ToolingService compatibility integrity", () => {
  const tenantId = "tenant-1";
  const compatiblePrisma = (overrides: Record<string, unknown> = {}) => ({
    machine: { findFirst: jest.fn().mockResolvedValue({ id: "machine-1" }) },
    toolDefinition: { findFirst: jest.fn().mockResolvedValue({ id: "tool-1" }) },
    toolAssembly: { findFirst: jest.fn().mockResolvedValue({ id: "assembly-1" }) },
    fixtureDefinition: { findFirst: jest.fn().mockResolvedValue({ id: "fixture-1" }) },
    toolMachineCompatibility: { create: jest.fn().mockResolvedValue({ id: "compatibility-1" }) },
    fixtureMachineCompatibility: { create: jest.fn().mockResolvedValue({ id: "compatibility-2" }) },
    ...overrides,
  });

  it("converts concurrent tool and fixture uniqueness races to controlled conflicts", async () => {
    const prisma = compatiblePrisma({
      toolMachineCompatibility: { create: jest.fn().mockRejectedValue({ code: "P2002" }) },
      fixtureMachineCompatibility: { create: jest.fn().mockRejectedValue({ code: "P2002" }) },
    });
    const service = new ToolingService(prisma as never, {} as never, {} as never, {} as never);

    await expect(service.addToolCompatibility(tenantId, { machineId: "machine-1", toolDefinitionId: "tool-1" })).rejects.toThrow(ConflictException);
    await expect(service.addFixtureCompatibility(tenantId, { machineId: "machine-1", fixtureDefinitionId: "fixture-1" })).rejects.toThrow(ConflictException);
  });

  it("rejects an ambiguous tool compatibility before it reaches persistence", async () => {
    const prisma = compatiblePrisma();
    const service = new ToolingService(prisma as never, {} as never, {} as never, {} as never);

    await expect(service.addToolCompatibility(tenantId, { machineId: "machine-1", toolDefinitionId: "tool-1", toolAssemblyId: "assembly-1" })).rejects.toThrow("Tam olarak bir takım tanımı veya assembly seçilmelidir");
    expect(prisma.toolMachineCompatibility.create).not.toHaveBeenCalled();
  });
});

describe("ToolingService physical tool state control", () => {
  const tenantId = "tenant-1";
  const userId = "user-1";

  const statefulService = (tool: Record<string, unknown>, updateCount = 1) => {
    const tx = {
      physicalToolInstance: {
        findFirst: jest.fn().mockResolvedValue(tool),
        updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
        findFirstOrThrow: jest.fn().mockResolvedValue({ ...tool, location: "CRIB-A-02", status: "QUARANTINED", version: 4 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const outbox = { record: jest.fn().mockResolvedValue({ id: "outbox-1" }) };
    return { service: new ToolingService(prisma as never, {} as never, {} as never, outbox as never), tx, prisma, outbox };
  };

  it("updates an available physical tool with optimistic locking, audit, and an outbox event", async () => {
    const { service, tx, outbox } = statefulService({ id: "tool-1", tenantId, version: 3, location: "CRIB-A-01", status: "AVAILABLE", remainingLife: 25 });

    await service.updatePhysicalToolState(tenantId, userId, "tool-1", { location: "CRIB-A-02", status: "QUARANTINED", version: 3, reason: "UÃ§ hasar kontrolÃ¼" });

    expect(tx.physicalToolInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "tool-1", tenantId, version: 3 },
      data: { location: "CRIB-A-02", status: "QUARANTINED", version: { increment: 1 } },
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entity: "PhysicalToolInstance", entityId: "tool-1", action: "STATUS_CHANGE" }) }));
    expect(outbox.record).toHaveBeenCalledWith(tx, tenantId, "physicalToolInstance", "tool-1", "physical-tool.state-updated", expect.objectContaining({ status: "QUARANTINED", version: 4 }));
  });

  it("rejects direct updates for a tool reserved by a verified setup", async () => {
    const { service, tx } = statefulService({ id: "tool-1", tenantId, version: 3, location: "MACHINE-1", status: "RESERVED", remainingLife: 25 });

    await expect(service.updatePhysicalToolState(tenantId, userId, "tool-1", { location: "CRIB-A-02", status: "AVAILABLE", version: 3, reason: "Yer deÄŸiÅŸimi" })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.physicalToolInstance.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a zero-life tool expired and rejects stale versions", async () => {
    const { service, tx } = statefulService({ id: "tool-1", tenantId, version: 3, location: "CRIB-A-01", status: "EXPIRED", remainingLife: 0 });

    await service.updatePhysicalToolState(tenantId, userId, "tool-1", { location: "SCRAP", status: "AVAILABLE", version: 3, reason: "Hurda alanÄ±na taÅŸÄ±ma" });
    expect(tx.physicalToolInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { location: "SCRAP", status: "EXPIRED", version: { increment: 1 } } }));

    const stale = statefulService({ id: "tool-1", tenantId, version: 4, location: "SCRAP", status: "EXPIRED", remainingLife: 0 });
    await expect(stale.service.updatePhysicalToolState(tenantId, userId, "tool-1", { location: "SCRAP", status: "RETIRED", version: 3, reason: "Eski ekran verisi" })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("ToolingService manual preset records", () => {
  const tenantId = "tenant-1";
  const userId = "user-1";

  const presetService = (toolStatus = "AVAILABLE") => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      physicalToolInstance: { findFirst: jest.fn().mockResolvedValue({ id: "tool-1", tenantId, status: toolStatus }) },
      machine: { findFirst: jest.fn().mockResolvedValue({ id: "machine-1", tenantId, isActive: true }) },
      toolPresetRecord: {
        findMany: jest.fn().mockResolvedValue([{ id: "preset-old" }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: "preset-new", status: "ACTIVE" }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const outbox = { record: jest.fn().mockResolvedValue({ id: "outbox-1" }) };
    return { service: new ToolingService(prisma as never, {} as never, {} as never, outbox as never), tx, outbox };
  };

  it("records a manual machine offset and supersedes the prior active preset atomically", async () => {
    const { service, tx, outbox } = presetService();

    await service.recordToolPreset(tenantId, userId, "tool-1", { machineId: "machine-1", offsetNumber: 17, lengthOffset: 128.456, radiusOffset: 6.25, measuredAt: new Date("2026-09-22T10:00:00.000Z"), reason: "Presetter ölçümü" });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.toolPresetRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId, physicalToolInstanceId: "tool-1", machineId: "machine-1", offsetNumber: 17, status: "ACTIVE" }) }));
    expect(tx.toolPresetRecord.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["preset-old"] }, tenantId, status: "ACTIVE" }, data: expect.objectContaining({ status: "SUPERSEDED" }) }));
    expect(tx.toolPresetRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId, physicalToolInstanceId: "tool-1", machineId: "machine-1", offsetNumber: 17, lengthOffset: 128.456, radiusOffset: 6.25, createdById: userId, status: "ACTIVE" }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entity: "ToolPresetRecord", action: "CREATE" }) }));
    expect(outbox.record).toHaveBeenCalledWith(tx, tenantId, "toolPresetRecord", "preset-new", "tool-preset.recorded", expect.objectContaining({ physicalToolInstanceId: "tool-1", machineId: "machine-1", offsetNumber: 17 }));
  });

  it("rejects a preset for a physical tool reserved by an active setup", async () => {
    const { service, tx } = presetService("RESERVED");

    await expect(service.recordToolPreset(tenantId, userId, "tool-1", { machineId: "machine-1", offsetNumber: 17, lengthOffset: 128.456, reason: "Geç kalmış ölçüm" })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.toolPresetRecord.create).not.toHaveBeenCalled();
  });
});

describe("ToolingService physical fixture custody", () => {
  const tenantId = "tenant-1";
  const userId = "user-1";

  const custodyService = (fixture: Record<string, unknown>, updateCount = 1) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      physicalFixtureInstance: {
        findFirst: jest.fn().mockResolvedValue(fixture),
        updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
        findFirstOrThrow: jest.fn().mockResolvedValue({ ...fixture, location: "SAHA-01", status: "CHECKED_OUT", version: 5 }),
      },
      fixtureCustodyEvent: { create: jest.fn().mockResolvedValue({ id: "custody-1", action: "CHECK_OUT" }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const outbox = { record: jest.fn().mockResolvedValue({ id: "outbox-1" }) };
    return { service: new ToolingService(prisma as never, {} as never, {} as never, outbox as never), tx, outbox };
  };

  it("checks an available fixture out with an atomic versioned custody event, audit, and outbox event", async () => {
    const { service, tx, outbox } = custodyService({ id: "fixture-1", tenantId, version: 4, location: "RAF-A-01", status: "AVAILABLE" });

    await service.checkOutPhysicalFixture(tenantId, userId, "fixture-1", { location: "SAHA-01", version: 4, reason: "Vardiya kurulumu için teslim" });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.physicalFixtureInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "fixture-1", tenantId, version: 4, status: "AVAILABLE" },
      data: { location: "SAHA-01", status: "CHECKED_OUT", version: { increment: 1 } },
    }));
    expect(tx.fixtureCustodyEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId, physicalFixtureInstanceId: "fixture-1", action: "CHECK_OUT", fromLocation: "RAF-A-01", toLocation: "SAHA-01", createdById: userId }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entity: "PhysicalFixtureInstance", entityId: "fixture-1", action: "STATUS_CHANGE" }) }));
    expect(outbox.record).toHaveBeenCalledWith(tx, tenantId, "physicalFixtureInstance", "fixture-1", "physical-fixture.checked-out", expect.objectContaining({ status: "CHECKED_OUT", version: 5 }));
  });

  it("checks a checked-out fixture in and restores availability", async () => {
    const { service, tx, outbox } = custodyService({ id: "fixture-1", tenantId, version: 4, location: "SAHA-01", status: "CHECKED_OUT" });

    await service.checkInPhysicalFixture(tenantId, userId, "fixture-1", { location: "RAF-A-01", version: 4, reason: "Vardiya sonrası iade" });

    expect(tx.physicalFixtureInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "fixture-1", tenantId, version: 4, status: "CHECKED_OUT" },
      data: { location: "RAF-A-01", status: "AVAILABLE", version: { increment: 1 } },
    }));
    expect(tx.fixtureCustodyEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "CHECK_IN", fromLocation: "SAHA-01", toLocation: "RAF-A-01" }) }));
    expect(outbox.record).toHaveBeenCalledWith(tx, tenantId, "physicalFixtureInstance", "fixture-1", "physical-fixture.checked-in", expect.objectContaining({ status: "AVAILABLE", version: 5 }));
  });

  it("rejects stale custody versions before changing fixture availability", async () => {
    const { service, tx } = custodyService({ id: "fixture-1", tenantId, version: 5, location: "RAF-A-01", status: "AVAILABLE" });

    await expect(service.checkOutPhysicalFixture(tenantId, userId, "fixture-1", { location: "SAHA-01", version: 4, reason: "Eski ekran verisi" })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.physicalFixtureInstance.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a custody command when the fixture is reserved by a setup", async () => {
    const { service, tx } = custodyService({ id: "fixture-1", tenantId, version: 4, location: "MAKINE-01", status: "RESERVED" });

    await expect(service.checkOutPhysicalFixture(tenantId, userId, "fixture-1", { location: "SAHA-01", version: 4, reason: "Yetkisiz teslim denemesi" })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.physicalFixtureInstance.updateMany).not.toHaveBeenCalled();
  });
});
