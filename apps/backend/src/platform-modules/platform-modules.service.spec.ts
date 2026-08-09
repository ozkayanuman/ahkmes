import { PlatformModulesService } from "./platform-modules.service";

describe("PlatformModulesService", () => {
  function build() {
    const tx: any = {
      tenantModuleEntitlement: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
      },
      tenant: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
    };
    const prisma: any = {
      tenantModuleEntitlement: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ edition: "ENTERPRISE" }) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    return { service: new PlatformModulesService(prisma), prisma, tx };
  }

  it("unconfigured modules are enabled by default for backward compatibility", async () => {
    const { service } = build();
    const modules = await service.list("tenant-1");
    expect(modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: "MES_EXECUTION", isEnabled: true, configured: false }),
    ]));
  });

  it("creates a missing entitlement and audit record in one transaction", async () => {
    const { service, tx } = build();
    tx.tenantModuleEntitlement.updateMany.mockResolvedValue({ count: 0 });
    tx.tenantModuleEntitlement.findUnique.mockResolvedValue(null);
    tx.tenantModuleEntitlement.create.mockResolvedValue({ id: "entitlement-1", module: "QMS_INSPECTION", isEnabled: false });

    await service.set("tenant-1", "admin-1", "QMS_INSPECTION" as never, false);

    expect(tx.tenantModuleEntitlement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "tenant-1", module: "QMS_INSPECTION", isEnabled: false }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "tenant-1", userId: "admin-1", entity: "tenant-module-entitlements", action: "CREATE" }),
    }));
  });

  it("records a single UPDATE audit when the stored state actually changes", async () => {
    const { service, tx } = build();
    tx.tenantModuleEntitlement.updateMany.mockResolvedValue({ count: 1 });
    tx.tenantModuleEntitlement.findUniqueOrThrow.mockResolvedValue({ id: "entitlement-1", module: "QMS_INSPECTION", isEnabled: false });

    await service.set("tenant-1", "admin-1", "QMS_INSPECTION" as never, false);

    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "UPDATE", before: expect.objectContaining({ isEnabled: true }) }),
    }));
  });

  it("does not create a second audit record for an idempotent update", async () => {
    const { service, tx } = build();
    tx.tenantModuleEntitlement.updateMany.mockResolvedValue({ count: 0 });
    tx.tenantModuleEntitlement.findUnique.mockResolvedValue({ id: "entitlement-1", isEnabled: false });

    await service.set("tenant-1", "admin-1", "QMS_INSPECTION" as never, false);

    expect(tx.tenantModuleEntitlement.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("retries a concurrent first-write race without duplicate audit", async () => {
    const { service, tx } = build();
    tx.tenantModuleEntitlement.updateMany.mockResolvedValue({ count: 0 });
    tx.tenantModuleEntitlement.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "entitlement-1", isEnabled: false });
    tx.tenantModuleEntitlement.create.mockRejectedValueOnce({ code: "P2002" });

    await service.set("tenant-1", "admin-1", "QMS_INSPECTION" as never, false);

    expect(tx.tenantModuleEntitlement.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects legacy and unimplemented entitlement codes", async () => {
    const { service, tx } = build();
    await expect(service.set("tenant-1", "admin-1", "PLATFORM_CORE" as never, false)).rejects.toThrow("Bilinmeyen");
    await expect(service.set("tenant-1", "admin-1", "MES_DNC" as never, true)).rejects.toThrow("Bilinmeyen");
    expect(tx.tenantModuleEntitlement.updateMany).not.toHaveBeenCalled();
  });

  it("tenant edition'ını aşan bir modülü etkinleştirmeyi reddeder", async () => {
    const { service, prisma, tx } = build();
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ edition: "FOUNDATION" });

    await expect(service.set("tenant-1", "admin-1", "PLATFORM_AI" as never, true)).rejects.toThrow("lisans");
    expect(tx.tenantModuleEntitlement.updateMany).not.toHaveBeenCalled();
  });

  it("tenant edition'ı yeterliyse modülü etkinleştirir", async () => {
    const { service, prisma, tx } = build();
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ edition: "ENTERPRISE" });
    tx.tenantModuleEntitlement.updateMany.mockResolvedValue({ count: 1 });
    tx.tenantModuleEntitlement.findUniqueOrThrow.mockResolvedValue({ id: "entitlement-1", module: "PLATFORM_AI", isEnabled: true });

    await expect(service.set("tenant-1", "admin-1", "PLATFORM_AI" as never, true)).resolves.toEqual(
      expect.objectContaining({ module: "PLATFORM_AI", isEnabled: true }),
    );
  });

  it("edition kontrolü kapatma (isEnabled:false) işlemini etkilemez", async () => {
    const { service, prisma, tx } = build();
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ edition: "FOUNDATION" });
    tx.tenantModuleEntitlement.updateMany.mockResolvedValue({ count: 1 });
    tx.tenantModuleEntitlement.findUniqueOrThrow.mockResolvedValue({ id: "entitlement-1", module: "PLATFORM_AI", isEnabled: false });

    await expect(service.set("tenant-1", "admin-1", "PLATFORM_AI" as never, false)).resolves.toEqual(
      expect.objectContaining({ isEnabled: false }),
    );
  });

  it("getEdition tenant'ın edition'ını döner", async () => {
    const { service, prisma } = build();
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ edition: "PROFESSIONAL" });
    await expect(service.getEdition("tenant-1")).resolves.toBe("PROFESSIONAL");
  });

  it("setEdition audit yazarak günceller", async () => {
    const { service, prisma, tx } = build();
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ edition: "ESSENTIALS" });
    tx.tenant.update.mockResolvedValue({ id: "tenant-1", edition: "PROFESSIONAL" });

    const result = await service.setEdition("tenant-1", "admin-1", "PROFESSIONAL" as never);

    expect(result).toEqual({ id: "tenant-1", edition: "PROFESSIONAL" });
    expect(tx.tenant.update).toHaveBeenCalledWith({ where: { id: "tenant-1" }, data: { edition: "PROFESSIONAL" } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: "tenant-1", userId: "admin-1", entity: "tenant", action: "UPDATE",
        before: expect.objectContaining({ edition: "ESSENTIALS" }),
        after: expect.objectContaining({ edition: "PROFESSIONAL" }),
      }),
    }));
  });
});
