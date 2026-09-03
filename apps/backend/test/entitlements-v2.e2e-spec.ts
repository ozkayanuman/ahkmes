import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { EntitlementGrantSource, ProductModule } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../src/app.module";
import { runWithTenant } from "../src/common/tenant-context";
import { TenantScopeViolationError } from "../src/prisma/tenant-scope.extension";
import { PrismaService } from "../src/prisma/prisma.service";
import { EntitlementsV2Service } from "../src/entitlements-v2/entitlements-v2.service";
import { CommercialMigrationService } from "../src/entitlements-v2/commercial-migration.service";

const STAMP = Date.now();

describe("PRODUCT-ARCH-002 entitlement V2 foundation (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: EntitlementsV2Service;
  let commercialMigration: CommercialMigrationService;
  let tenantA: string;
  let tenantB: string;
  let actorA: string;
  let actorB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(EntitlementsV2Service);
    commercialMigration = app.get(CommercialMigrationService);
    const passwordHash = await bcrypt.hash("TenantTest123!", 10);
    tenantA = `entitlement-v2-a-${STAMP}`;
    tenantB = `entitlement-v2-b-${STAMP}`;
    await prisma.tenant.createMany({ data: [{ id: tenantA, name: "Entitlement V2 A" }, { id: tenantB, name: "Entitlement V2 B" }] });
    const users = await Promise.all([
      prisma.user.create({ data: { tenantId: tenantA, email: `entitlement-v2-a-${STAMP}@test.local`, passwordHash, name: "Actor A", role: "ADMIN" } }),
      prisma.user.create({ data: { tenantId: tenantB, email: `entitlement-v2-b-${STAMP}@test.local`, passwordHash, name: "Actor B", role: "ADMIN" } }),
    ]);
    actorA = users[0].id;
    actorB = users[1].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("keeps standalone products independent, validates product/feature parents, and handles expiry", async () => {
    const mes = await service.grantProduct(tenantA, actorA, "MES");
    await service.grantFeature(tenantA, actorA, mes.id, "MES_OPERATOR_HMI");
    await service.grantFeature(tenantA, actorA, mes.id, "MES_GENEALOGY", EntitlementGrantSource.DIRECT, { expiresAt: new Date(Date.now() - 1_000) });
    await service.grantProduct(tenantA, actorA, "QMS");
    await service.grantProduct(tenantA, actorA, "CMMS");
    await service.grantProduct(tenantA, actorA, "HR");
    const crm = await service.grantProduct(tenantA, actorA, "CRM");
    await service.grantProduct(tenantA, actorA, "CNC");
    await service.grantProduct(tenantA, actorA, "FINANCE", EntitlementGrantSource.DIRECT, { expiresAt: new Date(Date.now() - 1_000) });

    expect(await service.resolve(tenantA, "MES", "MES_OPERATOR_HMI")).toEqual(expect.objectContaining({ active: true, source: "DIRECT", platformCapabilityIds: expect.arrayContaining(["SHARED_MASTER_DATA"]) }));
    expect((await service.resolve(tenantA, "CRM")).active).toBe(true);
    expect((await service.resolve(tenantA, "SALES")).active).toBe(false);
    expect((await service.resolve(tenantA, "QMS")).active).toBe(true);
    expect((await service.resolve(tenantA, "CMMS")).active).toBe(true);
    expect((await service.resolve(tenantA, "HR")).active).toBe(true);
    expect((await service.resolve(tenantA, "CNC")).active).toBe(true);
    expect((await service.resolve(tenantA, "FINANCE")).reason).toBe("PRODUCT_GRANT_INACTIVE");
    expect((await service.resolve(tenantA, "MES", "MES_GENEALOGY")).reason).toBe("FEATURE_GRANT_INACTIVE");
    await expect(service.grantProduct(tenantA, actorA, "SHARED_MASTER_DATA" as any)).rejects.toThrow("non-sellable");
    await expect(service.grantFeature(tenantA, actorA, crm.id, "MES_OPERATOR_HMI")).rejects.toThrow("does not belong");
  });

  it("keeps split technical access in review until a tenant-bound approval and reconciles idempotently", async () => {
    await prisma.tenantModuleEntitlement.createMany({
      data: Object.values(ProductModule).map((module) => ({ tenantId: tenantB, module, isEnabled: false })),
    });
    await prisma.tenantModuleEntitlement.updateMany({ where: { tenantId: tenantB, module: { in: ["ERP_CRM_SALES", "ERP_PROJECT_SERVICE", "MES_CNC_TOOLING", "MES_EXECUTION"] } }, data: { isEnabled: true } });

    const dryRun = await commercialMigration.dryRun(tenantB);
    expect(dryRun.candidates.filter((candidate) => ["ERP_CRM_SALES", "ERP_PROJECT_SERVICE", "MES_CNC_TOOLING"].includes(candidate.legacyCode)).every((candidate) => candidate.decision === "REVIEW_REQUIRED")).toBe(true);
    expect(await prisma.productGrant.count({ where: { tenantId: tenantB } })).toBe(0);

    await expect(commercialMigration.reconcile(tenantB, actorB, { legacyCodes: ["MES_CNC_TOOLING"] })).rejects.toThrow("review is required");
    await commercialMigration.approveReviewCandidate(tenantB, actorB, "MES_CNC_TOOLING", {
      productIds: ["TOOLING"], featureIds: ["TOOLING_TOOL_MANAGEMENT"],
    }, "Tenant contract confirms tooling only");
    await commercialMigration.reconcile(tenantB, actorB, { legacyCodes: ["MES_CNC_TOOLING"] });
    const firstCount = await prisma.productGrant.count({ where: { tenantId: tenantB, source: "MIGRATED" } });
    await commercialMigration.reconcile(tenantB, actorB, { legacyCodes: ["MES_CNC_TOOLING"] });
    expect(await prisma.productGrant.count({ where: { tenantId: tenantB, source: "MIGRATED" } })).toBe(firstCount);
    expect(await prisma.entitlementReconciliation.findUniqueOrThrow({ where: { tenantId_legacyCode_mappingVersion_policyVersion: { tenantId: tenantB, legacyCode: "MES_CNC_TOOLING", mappingVersion: "PRODUCT-ARCH-001-v1", policyVersion: "PRODUCT-ARCH-003-v1" } } })).toEqual(expect.objectContaining({ status: "RECONCILED", evidenceClassification: "AMBIGUOUS_SPLIT" }));

    // Migration-owned MES is separately traceable from a pre-existing direct
    // MES grant. Rolling back this run must not remove direct effective access.
    await service.grantProduct(tenantB, actorB, "MES");
    const mesRun = await commercialMigration.reconcile(tenantB, actorB, { legacyCodes: ["MES_EXECUTION"] });
    if (mesRun.dryRun) throw new Error("Expected materialised commercial migration run");
    expect(await prisma.productGrant.count({ where: { tenantId: tenantB, productId: "MES", source: "MIGRATED" } })).toBe(1);
    await commercialMigration.rollback(tenantB, actorB, mesRun.runId, "Controlled replay verification");
    expect(await service.resolve(tenantB, "MES")).toEqual(expect.objectContaining({ active: true, source: "DIRECT" }));
  });

  it("enforces tenant scope for V2 reads, mutation, and resolver access", async () => {
    await expect(runWithTenant(tenantB, () => service.resolve(tenantA, "MES"))).rejects.toThrow(TenantScopeViolationError);
    await expect(runWithTenant(tenantB, () => commercialMigration.reconcile(tenantA, actorB, { dryRun: true }))).rejects.toThrow(TenantScopeViolationError);
    await expect(runWithTenant(tenantB, () => prisma.productGrant.findMany({ where: { tenantId: tenantA } }))).rejects.toThrow(TenantScopeViolationError);
    await expect(runWithTenant(tenantB, () => prisma.productGrant.updateMany({ where: { tenantId: tenantA }, data: { status: "REVOKED" } }))).rejects.toThrow(TenantScopeViolationError);
    expect((await service.resolve(tenantA, "MES")).active).toBe(true);
  });

  it("rejects cross-tenant V2 parent, approval, and reconciliation links at the PostgreSQL boundary", async () => {
    const licenceA = await prisma.tenantLicence.findUniqueOrThrow({ where: { tenantId: tenantA } });
    const mesGrantA = await prisma.productGrant.findFirstOrThrow({ where: { tenantId: tenantA, productId: "MES", source: "DIRECT" } });
    const directQmsB = await service.grantProduct(tenantB, actorB, "QMS");
    const runA = await prisma.entitlementMigrationRun.create({
      data: { tenantId: tenantA, mappingVersion: "PRODUCT-ARCH-001-v1", policyVersion: "PRODUCT-ARCH-003-v1", actorUserId: actorA, correlationId: `cross-tenant-run-${STAMP}` },
    });

    await expect(prisma.productGrant.create({
      // SALES is intentionally unused on licence A so the composite parent FK,
      // rather than the grant's source uniqueness constraint, is exercised.
      data: { tenantLicenceId: licenceA.id, tenantId: tenantB, productId: "SALES", source: "DIRECT" },
    })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.featureGrant.create({
      // This feature is not granted by the earlier scenario, so this assertion
      // reaches the composite product-grant/tenant FK rather than uniqueness.
      data: { productGrantId: mesGrantA.id, tenantId: tenantB, featureId: "MES_ELECTRONIC_WORK_INSTRUCTIONS", source: "DIRECT" },
    })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.entitlementMigrationApproval.create({
      data: {
        tenantId: tenantA, legacyCode: `approval-cross-tenant-${STAMP}`, mappingVersion: "PRODUCT-ARCH-001-v1", policyVersion: "PRODUCT-ARCH-003-v1",
        approvedProductIds: ["MES"], approvedFeatureIds: ["MES_EXECUTION"], approvedByUserId: actorB, reason: "Must fail",
      },
    })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.entitlementReconciliation.create({
      data: {
        tenantId: tenantB, legacyCode: `reconciliation-cross-tenant-${STAMP}`, mappingVersion: "PRODUCT-ARCH-001-v1", policyVersion: "PRODUCT-ARCH-003-v1",
        legacyIsEnabled: true, status: "RECONCILED", projectedProductIds: ["QMS"], projectedFeatureIds: [], sourceSnapshot: {},
        correlationId: `cross-tenant-reconciliation-${STAMP}`, migrationRunId: runA.id, actorUserId: actorB, reason: "Must fail",
      },
    })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.productGrantMigrationProvenance.create({
      data: {
        tenantId: tenantB, migrationRunId: runA.id, productGrantId: directQmsB.id, legacyCode: "MES_EXECUTION",
        mappingVersion: "PRODUCT-ARCH-001-v1", policyVersion: "PRODUCT-ARCH-003-v1",
      },
    })).rejects.toMatchObject({ code: "P2003" });
  });
});
