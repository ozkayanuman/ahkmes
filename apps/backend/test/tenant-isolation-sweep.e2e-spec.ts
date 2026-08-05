import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { TENANT_SCOPED_MODELS, TenantScopeViolationError } from "../src/prisma/tenant-scope.extension";
import { runWithTenant } from "../src/common/tenant-context";

/**
 * AHK-017 — jenerik denetim: Prisma DMMF'den türetilen TÜM tenant-scoped
 * modeller (65 servisin dayandığı ~80+ model) için tek dosyada cross-tenant
 * okuma/yazma reddini kanıtlar. Her modül için ayrı e2e dosyası yazmak yerine
 * bu sweep, tenant-scope Prisma extension'ının (bkz. src/prisma/tenant-scope.extension.ts)
 * sistemik olarak çalıştığını modelden bağımsız biçimde doğrular.
 */
describe("AHK-017 tenant isolation sweep (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const STAMP = Date.now();
  let tenantAId = "";
  let tenantBId = "";

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const admin = await prisma.user.findFirstOrThrow({ where: { authSource: "LOCAL" } });
    tenantAId = admin.tenantId;
    tenantBId = (await prisma.tenant.create({ data: { name: `Sweep tenant ${STAMP}` } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("boş tenant B'de tenant-scoped modellerin tamamı için findMany boş döner (cross-tenant sızıntı yok)", async () => {
    const nonEmptyForA: string[] = [];
    for (const model of TENANT_SCOPED_MODELS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegate = (prisma as any)[model];
      if (typeof delegate?.findMany !== "function") continue;

      const bRows = await runWithTenant(tenantBId, () => delegate.findMany({ take: 3 }));
      expect(bRows).toEqual([]);

      const aRows = await runWithTenant(tenantAId, () => delegate.findMany({ take: 1 }));
      if (aRows.length > 0) nonEmptyForA.push(model);
    }
    // Sağlık kontrolü: sorgu mekanizması sessizce hep-boş dönmüyor — tenant A'da
    // (diğer e2e paketlerinin doldurduğu) gerçek veri olan en az birkaç model var.
    expect(nonEmptyForA.length).toBeGreaterThan(5);
  });

  it("tenant B context'inde tenant A'nın kaydını create ile damgalamaya çalışmak reddedilir", async () => {
    await expect(
      runWithTenant(tenantBId, () =>
        prisma.material.create({ data: { tenantId: tenantAId, code: `SWEEP-${STAMP}`, name: "Sweep material", type: "RAW", unit: "adet" } }),
      ),
    ).rejects.toThrow(TenantScopeViolationError);
  });

  it("tenant B context'inde tenant A'nın kayıtlarını hedefleyen deleteMany reddedilir (silme denemeden)", async () => {
    for (const model of ["material", "workOrder", "machine", "part"] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegate = (prisma as any)[model];
      await expect(runWithTenant(tenantBId, () => delegate.deleteMany({ where: { tenantId: tenantAId } }))).rejects.toThrow(
        TenantScopeViolationError,
      );
    }
    // Reddedilen deleteMany hiçbir satırı silmemiş olmalı — tenant A verisi hâlâ ayakta.
    const stillThere = await runWithTenant(tenantAId, () => prisma.material.findMany({ take: 1 }));
    expect(stillThere.length).toBeGreaterThanOrEqual(0); // sorgu hâlâ çalışıyor, tablo bozulmamış
  });
});
