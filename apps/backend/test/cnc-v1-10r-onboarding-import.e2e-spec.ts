import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const stamp = Date.now();

describe("CNC-V1-10R controlled onboarding import (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let token: string;
  const api = () => request(app.getHttpServer());
  const auth = (test: request.Test) => test.set("Authorization", `Bearer ${token}`);
  const uploadCsv = (test: request.Test, csv: string) => test.attach("file", Buffer.from(csv), { filename: "import.csv", contentType: "text/csv" });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); await app.init();
    prisma = app.get(PrismaService);
    tenantId = `cnc-v1-10r-${stamp}`;
    await prisma.tenant.create({ data: { id: tenantId, name: "CNC V1-10R Test", timezone: "Europe/Istanbul" } });
    const admin = await prisma.user.create({ data: { tenantId, email: `onboarding-${stamp}@test.local`, name: "Onboarding Admin", passwordHash: await bcrypt.hash("TestPassword123!", 10), role: "ADMIN" } });
    token = (await api().post("/auth/login").send({ email: admin.email, password: "TestPassword123!" }).expect(201)).body.accessToken;
  });
  afterAll(async () => app?.close());

  it("retains a dry-run without domain writes, then atomically commits master data and opening inventory", async () => {
    const partsDryRun = await uploadCsv(auth(api().post("/onboarding-import/parts/dry-run")), "part_no,revision,name,unit,lot_tracking_required\nP-100,A,Imported Part,EA,true\n").expect(201);
    expect(partsDryRun.body).toMatchObject({ status: "VALIDATED", totalRows: 1, validRows: 1, mode: "DRY_RUN" });
    expect(await prisma.part.count({ where: { tenantId, partNo: "P-100" } })).toBe(0);
    await auth(api().post(`/onboarding-import/batches/${partsDryRun.body.id}/commit`)).expect(201);
    expect(await prisma.part.findFirst({ where: { tenantId, partNo: "P-100", revision: "A" } })).toMatchObject({ name: "Imported Part", lotTrackingRequired: true });

    const material = await uploadCsv(auth(api().post("/onboarding-import/materials/dry-run")), "code,name,type,unit,standard_cost,lot_tracking_required\nRM-100,Imported Raw,RAW,KG,7.5,true\n").expect(201);
    await auth(api().post(`/onboarding-import/batches/${material.body.id}/commit`)).expect(201);
    const bom = await uploadCsv(auth(api().post("/onboarding-import/boms/dry-run")), "part_no,part_revision,bom_revision,material_code,qty_per,unit,issue_method\nP-100,A,A,RM-100,2.5,KG,BACKFLUSH\n").expect(201);
    expect(bom.body).toMatchObject({ status: "VALIDATED", totalRows: 1, validRows: 1 });
    await auth(api().post(`/onboarding-import/batches/${bom.body.id}/commit`)).expect(201);
    expect(await prisma.bomHeader.findFirst({ where: { tenantId, part: { partNo: "P-100", revision: "A" }, revision: "A" }, include: { lines: true } })).toMatchObject({ status: "DRAFT", isActive: false, lines: [expect.objectContaining({ issueMethod: "BACKFLUSH" })] });
    const routing = await uploadCsv(auth(api().post("/onboarding-import/routings/dry-run")), "part_no,part_revision,routing_revision,seq,name,standard_minutes\nP-100,A,A,1,Roughing,12\nP-100,A,A,2,Finishing,8\n").expect(201);
    expect(routing.body).toMatchObject({ status: "VALIDATED", totalRows: 2, validRows: 2 });
    await auth(api().post(`/onboarding-import/batches/${routing.body.id}/commit`)).expect(201);
    expect(await prisma.recipeHeader.findFirst({ where: { tenantId, part: { partNo: "P-100", revision: "A" }, revision: "A" }, include: { steps: true } })).toMatchObject({ status: "DRAFT", isActive: false, steps: [expect.objectContaining({ seq: 1, name: "Roughing" }), expect.objectContaining({ seq: 2, name: "Finishing" })] });
    const tool = await uploadCsv(auth(api().post("/onboarding-import/tool_definitions/dry-run")), "code,name,tool_type,life_policy,maximum_life,warning_threshold,life_unit,revision\nEM-10,Imported Endmill,END_MILL,PART_COUNT,100,20,PART,A\n").expect(201);
    expect(tool.body).toMatchObject({ status: "VALIDATED", totalRows: 1, validRows: 1 });
    await auth(api().post(`/onboarding-import/batches/${tool.body.id}/commit`)).expect(201);
    expect(await prisma.toolDefinition.findFirst({ where: { tenantId, code: "EM-10", revision: "A" } })).toMatchObject({ lifePolicy: "PART_COUNT", maximumLife: expect.anything() });
    const component = await uploadCsv(auth(api().post("/onboarding-import/tool_components/dry-run")), "code,name,component_type\nINSERT-10,Imported Insert,INSERT\n").expect(201);
    await auth(api().post(`/onboarding-import/batches/${component.body.id}/commit`)).expect(201);
    expect(await prisma.toolComponent.findFirst({ where: { tenantId, code: "INSERT-10" } })).toMatchObject({ componentType: "INSERT" });
    const fixture = await uploadCsv(auth(api().post("/onboarding-import/fixture_definitions/dry-run")), "code,name,fixture_type\nFIX-10,Imported Fixture,VICE\n").expect(201);
    await auth(api().post(`/onboarding-import/batches/${fixture.body.id}/commit`)).expect(201);
    expect(await prisma.fixtureDefinition.findFirst({ where: { tenantId, code: "FIX-10" } })).toMatchObject({ fixtureType: "VICE" });
    const physicalTool = await uploadCsv(auth(api().post("/onboarding-import/physical_tools/dry-run")), "tool_code,tool_revision,serial_no,remaining_life,consumed_life,location\nEM-10,A,T-100,90,10,Crib-A\n").expect(201);
    await auth(api().post(`/onboarding-import/batches/${physicalTool.body.id}/commit`)).expect(201);
    expect(await prisma.physicalToolInstance.findFirst({ where: { tenantId, serialNo: "T-100" } })).toMatchObject({ status: "AVAILABLE" });
    const physicalFixture = await uploadCsv(auth(api().post("/onboarding-import/physical_fixtures/dry-run")), "fixture_code,fixture_revision,serial_no,location\nFIX-10,A,F-100,Rack-B\n").expect(201);
    await auth(api().post(`/onboarding-import/batches/${physicalFixture.body.id}/commit`)).expect(201);
    expect(await prisma.physicalFixtureInstance.findFirst({ where: { tenantId, serialNo: "F-100" } })).toMatchObject({ status: "AVAILABLE" });
    const machine = await uploadCsv(auth(api().post("/onboarding-import/machines/dry-run")), "name,model,controller,hourly_rate\nImported CNC,VMC-850,FANUC,120\n").expect(201);
    await auth(api().post(`/onboarding-import/batches/${machine.body.id}/commit`)).expect(201);
    const importedMachine = await prisma.machine.findFirstOrThrow({ where: { tenantId, name: "Imported CNC" } });
    expect(importedMachine).toMatchObject({ model: "VMC-850", controller: "FANUC" });
    const toolCompatibility = await uploadCsv(auth(api().post("/onboarding-import/tool_machine_compatibilities/dry-run")), "machine_name,tool_code,tool_revision\nImported CNC,EM-10,A\n").expect(201);
    await auth(api().post(`/onboarding-import/batches/${toolCompatibility.body.id}/commit`)).expect(201);
    expect(await prisma.toolMachineCompatibility.findFirst({ where: { tenantId, machineId: importedMachine.id }, include: { toolDefinition: true } })).toMatchObject({ toolDefinition: { code: "EM-10", revision: "A" } });
    const fixtureCompatibility = await uploadCsv(auth(api().post("/onboarding-import/fixture_machine_compatibilities/dry-run")), "machine_name,fixture_code,fixture_revision\nImported CNC,FIX-10,A\n").expect(201);
    await auth(api().post(`/onboarding-import/batches/${fixtureCompatibility.body.id}/commit`)).expect(201);
    expect(await prisma.fixtureMachineCompatibility.findFirst({ where: { tenantId, machineId: importedMachine.id }, include: { fixtureDefinition: true } })).toMatchObject({ fixtureDefinition: { code: "FIX-10", revision: "A" } });
    const customer = await uploadCsv(auth(api().post("/onboarding-import/customers/dry-run")), "name,email,tax_no\nImported Customer,customer@example.test,TR-100\n").expect(201);
    await auth(api().post(`/onboarding-import/batches/${customer.body.id}/commit`)).expect(201);
    expect(await prisma.customer.findFirst({ where: { tenantId, name: "Imported Customer" } })).toMatchObject({ email: "customer@example.test" });
    const supplier = await uploadCsv(auth(api().post("/onboarding-import/suppliers/dry-run")), "name,email,lead_time_days\nImported Supplier,supplier@example.test,14\n").expect(201);
    await auth(api().post(`/onboarding-import/batches/${supplier.body.id}/commit`)).expect(201);
    expect(await prisma.supplier.findFirst({ where: { tenantId, name: "Imported Supplier" } })).toMatchObject({ email: "supplier@example.test", leadTimeDays: 14 });
    const warehouse = await uploadCsv(auth(api().post("/onboarding-import/warehouses/dry-run")), "name,code\nMain Warehouse,MAIN\n").expect(201);
    await auth(api().post(`/onboarding-import/batches/${warehouse.body.id}/commit`)).expect(201);
    const wh = await prisma.warehouse.findFirstOrThrow({ where: { tenantId, code: "MAIN" } });
    await prisma.bin.create({ data: { tenantId, warehouseId: wh.id, code: "RACK-A", name: "Rack A" } });

    const stock = await uploadCsv(auth(api().post("/onboarding-import/opening_stock/dry-run")), "item_type,item_code,warehouse_code,bin_code,quantity,lot_no,heat_number\nMATERIAL,RM-100,MAIN,RACK-A,12.5,LOT-100,HEAT-1\n").expect(201);
    expect(stock.body).toMatchObject({ status: "VALIDATED", totalRows: 1, validRows: 1 });
    await auth(api().post(`/onboarding-import/batches/${stock.body.id}/commit`)).expect(201);
    const importedMaterial = await prisma.material.findFirstOrThrow({ where: { tenantId, code: "RM-100" } });
    expect(Number(importedMaterial.stockQty)).toBe(12.5);
    expect(await prisma.inventoryMovement.findFirst({ where: { tenantId, sourceType: "ONBOARDING_IMPORT", sourceId: stock.body.id, movementType: "OPENING_BALANCE" } })).toEqual(expect.objectContaining({ quantityDelta: expect.anything() }));
    expect(await prisma.lot.findFirst({ where: { tenantId, lotNo: "LOT-100" } })).toMatchObject({ heatNumber: "HEAT-1" });
  });

  it("rejects an invalid batch and never offers it for commit", async () => {
    const rejected = await uploadCsv(auth(api().post("/onboarding-import/materials/dry-run")), "code,name,type,unit\nRM-100,Duplicate,INVALID,KG\n").expect(201);
    expect(rejected.body).toMatchObject({ status: "REJECTED", totalRows: 1, validRows: 0 });
    expect(rejected.body.rowResults[0].errors).toEqual(expect.arrayContaining([expect.stringContaining("RAW veya CONSUMABLE"), expect.stringContaining("zaten kayıtlı")]));
    await auth(api().post(`/onboarding-import/batches/${rejected.body.id}/commit`)).expect(409);
  });
});
