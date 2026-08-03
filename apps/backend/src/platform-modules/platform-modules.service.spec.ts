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
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
    };
    const prisma: any = {
      tenantModuleEntitlement: { findMany: jest.fn().mockResolvedValue([]) },
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
});
