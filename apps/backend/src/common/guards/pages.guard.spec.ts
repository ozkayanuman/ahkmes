import { PagesGuard } from "./pages.guard";

describe("PagesGuard module entitlement policy", () => {
  const contextFor = (user: unknown) => ({
    getHandler: () => "handler",
    getClass: () => "controller",
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any;

  function build(required = ["inspections"] as any) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) };
    const prisma = {
      tenantModuleEntitlement: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ edition: "ENTERPRISE" }) },
    };
    return { guard: new PagesGuard(reflector as any, prisma as any), prisma };
  }

  it("allows an authorized user when the mapped module is enabled", async () => {
    const { guard, prisma } = build();
    await expect(guard.canActivate(contextFor({ tenantId: "tenant-1", pages: ["inspections"] }))).resolves.toBe(true);
    expect(prisma.tenantModuleEntitlement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: "tenant-1", module: { in: ["QMS_INSPECTION"] }, isEnabled: false }),
    }));
  });

  it("blocks even an all-pages administrator when the product module is disabled", async () => {
    const { guard, prisma } = build();
    prisma.tenantModuleEntitlement.findMany.mockResolvedValue([{ module: "QMS_INSPECTION" }]);
    await expect(guard.canActivate(contextFor({ tenantId: "tenant-1", pages: "*" }))).rejects.toThrow("modül");
  });

  it("does not query entitlements when page permission is missing", async () => {
    const { guard, prisma } = build();
    await expect(guard.canActivate(contextFor({ tenantId: "tenant-1", pages: ["materials"] }))).rejects.toThrow("sayfa");
    expect(prisma.tenantModuleEntitlement.findMany).not.toHaveBeenCalled();
  });

  it("keeps mandatory Platform Core pages available without a tenant entitlement row", async () => {
    const { guard, prisma } = build(["platform-modules"] as any);
    prisma.tenantModuleEntitlement.findMany.mockResolvedValue([{ module: "PLATFORM_CORE" }]);
    await expect(guard.canActivate(contextFor({ tenantId: "tenant-1", pages: ["platform-modules"] }))).resolves.toBe(true);
    expect(prisma.tenantModuleEntitlement.findMany).not.toHaveBeenCalled();
  });

  it("tenant edition'ı modülün gerektirdiği edition'ın altındaysa reddeder", async () => {
    const { guard, prisma } = build(["copilot"] as any); // copilot → PLATFORM_AI, edition ENTERPRISE
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ edition: "PROFESSIONAL" });
    await expect(guard.canActivate(contextFor({ tenantId: "tenant-1", pages: ["copilot"] }))).rejects.toThrow("modül");
  });

  it("tenant edition'ı yeterliyse ve modül disabled değilse izin verir", async () => {
    const { guard, prisma } = build(["copilot"] as any);
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ edition: "ENTERPRISE" });
    await expect(guard.canActivate(contextFor({ tenantId: "tenant-1", pages: ["copilot"] }))).resolves.toBe(true);
  });
});
