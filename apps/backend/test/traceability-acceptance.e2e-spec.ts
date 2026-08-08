import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();
const DUE = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

describe("AHK-005 — lot kabulü ve as-built izlenebilirlik (e2e)", () => {
  let app: INestApplication;
  let adminToken: string;
  let materialId: string;
  let partId: string;
  let workOrderId: string;
  let acceptedMaterialLotId: string;
  let pendingMaterialLotId: string;

  const api = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }).expect(201);
    adminToken = login.body.accessToken;

    materialId = (await auth(api().post("/materials").send({
      code: `TRACE-MAT-${STAMP}`,
      name: "4140 doğrulanmış çelik",
      type: "RAW",
      unit: "kg",
      lotTrackingRequired: true,
      certificateRequired: true,
    })).expect(201)).body.id;
    partId = (await auth(api().post("/parts").send({
      partNo: `TRACE-PART-${STAMP}`,
      revision: "A",
      name: "İzlenebilir mamul",
      lotTrackingRequired: true,
    })).expect(201)).body.id;
    workOrderId = (await auth(api().post("/work-orders").send({ partId, quantity: 3, dueDate: DUE })).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("sertifikasız lot kabul edilemez; kabul/red kararı geri alınamaz", async () => {
    const noCertificate = await auth(api().post("/lots").send({
      lotNo: `TRACE-NOCOC-${STAMP}`,
      itemType: "MATERIAL",
      itemId: materialId,
      heatNumber: "H-4140-01",
    })).expect(201);
    await auth(api().post(`/lots/${noCertificate.body.id}/acceptance`).send({ status: "ACCEPTED" })).expect(409);

    const accepted = await auth(api().post("/lots").send({
      lotNo: `TRACE-ACC-${STAMP}`,
      itemType: "MATERIAL",
      itemId: materialId,
      heatNumber: "H-4140-02",
      supplierLotNo: "SUP-4140-02",
      certificateNo: "EN10204-3.1-4140-02",
    })).expect(201);
    acceptedMaterialLotId = accepted.body.id;
    const decision = await auth(api().post(`/lots/${acceptedMaterialLotId}/acceptance`).send({ status: "ACCEPTED" })).expect(201);
    expect(decision.body.acceptanceStatus).toBe("ACCEPTED");
    expect(decision.body.acceptedById).toBeTruthy();
    const audit = await auth(api().get(`/audit-log?entity=lots&entityId=${acceptedMaterialLotId}`)).expect(200);
    expect(audit.body.some((entry: { action: string }) => entry.action === "STATUS_CHANGE")).toBe(true);
    await auth(api().post(`/lots/${acceptedMaterialLotId}/acceptance`).send({ status: "REJECTED" })).expect(409);

    pendingMaterialLotId = (await auth(api().post("/lots").send({
      lotNo: `TRACE-PENDING-${STAMP}`,
      itemType: "MATERIAL",
      itemId: materialId,
      certificateNo: "EN10204-3.1-PENDING",
    })).expect(201)).body.id;
  });

  it("satın alma ve tüketim, zorunlu/kabul edilmemiş lotları reddeder", async () => {
    const supplierId = (await auth(api().post("/suppliers").send({ name: `Trace supplier ${STAMP}` })).expect(201)).body.id;
    const po = await auth(api().post("/purchase-orders").send({
      supplierId,
      orderDate: new Date().toISOString(),
      lines: [{ materialId, quantity: 10, unitPrice: 1 }],
    })).expect(201);
    const lineId = po.body.lines[0].id;

    await auth(api().post(`/purchase-orders/${po.body.id}/receive`).send({ lines: [{ lineId, receivedQty: 10 }] })).expect(409);
    await auth(api().post(`/purchase-orders/${po.body.id}/receive`).send({ lines: [{ lineId, receivedQty: 10, lotId: pendingMaterialLotId }] })).expect(409);
    await auth(api().post(`/purchase-orders/${po.body.id}/receive`).send({ lines: [{ lineId, receivedQty: 10, lotId: acceptedMaterialLotId }] })).expect(201);

    await auth(api().post("/consumptions").send({ workOrderId, itemType: "MATERIAL", itemId: materialId, type: "CONSUMED", quantity: 2 })).expect(409);
    await auth(api().post("/consumptions").send({ workOrderId, itemType: "MATERIAL", itemId: materialId, type: "CONSUMED", quantity: 2, lotId: pendingMaterialLotId })).expect(409);
    const consumed = await auth(api().post("/consumptions").send({
      workOrderId,
      itemType: "MATERIAL",
      itemId: materialId,
      type: "CONSUMED",
      quantity: 2,
      lotId: acceptedMaterialLotId,
    })).expect(201);
    expect(consumed.body.lotId).toBe(acceptedMaterialLotId);
  });

  it("mamul girişi zorunlu lotla ve iki yönlü as-built zincirle kaydedilir", async () => {
    await auth(api().post("/finished-goods").send({ workOrderId, quantity: 3 })).expect(409);
    const finishedLot = await auth(api().post("/lots").send({
      lotNo: `TRACE-FG-${STAMP}`,
      itemType: "PART",
      itemId: partId,
    })).expect(201);
    await auth(api().post("/finished-goods").send({ workOrderId, quantity: 3, lotId: finishedLot.body.id })).expect(201);

    const materialTrace = await auth(api().get(`/lots/${acceptedMaterialLotId}/trace`)).expect(200);
    expect(materialTrace.body.forward.consumedByWorkOrders[0].workOrder.id).toBe(workOrderId);
    expect(materialTrace.body.forward.consumedByWorkOrders[0].producedLots.map((entry: { lot: { id: string } }) => entry.lot.id)).toContain(finishedLot.body.id);

    const partTrace = await auth(api().get(`/lots/${finishedLot.body.id}/trace`)).expect(200);
    expect(partTrace.body.backward.producedByWorkOrders[0].workOrder.id).toBe(workOrderId);
    expect(partTrace.body.backward.producedByWorkOrders[0].consumedLots.map((l: { lot: { id: string } }) => l.lot.id)).toContain(acceptedMaterialLotId);
  });
});

describe("AHK Faz K (Faz 3) — çok seviyeli (alt montaj) izlenebilirlik zinciri (e2e)", () => {
  let app: INestApplication;
  let adminToken: string;
  const api = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);

  let materialId: string;
  let subPartId: string;
  let topPartId: string;
  let subWorkOrderId: string;
  let topWorkOrderId: string;
  let materialLotId: string;
  let subLotId: string;
  let topLotId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }).expect(201);
    adminToken = login.body.accessToken;

    materialId = (await auth(api().post("/materials").send({
      code: `TRACE3-MAT-${STAMP}`,
      name: "Ham çelik",
      type: "RAW",
      unit: "kg",
    })).expect(201)).body.id;
    subPartId = (await auth(api().post("/parts").send({
      partNo: `TRACE3-SUB-${STAMP}`,
      revision: "A",
      name: "Alt montaj",
    })).expect(201)).body.id;
    topPartId = (await auth(api().post("/parts").send({
      partNo: `TRACE3-TOP-${STAMP}`,
      revision: "A",
      name: "Üst montaj",
    })).expect(201)).body.id;

    // Seviye 1: SUB parçası için iş emri — hammaddeden üretilir.
    subWorkOrderId = (await auth(api().post("/work-orders").send({ partId: subPartId, quantity: 5, dueDate: DUE })).expect(201)).body.id;
    materialLotId = (await auth(api().post("/lots").send({
      lotNo: `TRACE3-MAT-LOT-${STAMP}`,
      itemType: "MATERIAL",
      itemId: materialId,
    })).expect(201)).body.id;
    await auth(api().post(`/lots/${materialLotId}/acceptance`).send({ status: "ACCEPTED" })).expect(201);

    // Tüketilebilmesi için önce stok girişi (satın alma + teslim alma) gerekir.
    const supplierId = (await auth(api().post("/suppliers").send({ name: `Trace3 supplier ${STAMP}` })).expect(201)).body.id;
    const po = await auth(api().post("/purchase-orders").send({
      supplierId,
      orderDate: new Date().toISOString(),
      lines: [{ materialId, quantity: 5, unitPrice: 1 }],
    })).expect(201);
    await auth(api().post(`/purchase-orders/${po.body.id}/receive`).send({
      lines: [{ lineId: po.body.lines[0].id, receivedQty: 5, lotId: materialLotId }],
    })).expect(201);

    await auth(api().post("/consumptions").send({
      workOrderId: subWorkOrderId,
      itemType: "MATERIAL",
      itemId: materialId,
      type: "CONSUMED",
      quantity: 5,
      lotId: materialLotId,
    })).expect(201);
    subLotId = (await auth(api().post("/lots").send({
      lotNo: `TRACE3-SUB-LOT-${STAMP}`,
      itemType: "PART",
      itemId: subPartId,
    })).expect(201)).body.id;
    await auth(api().post("/finished-goods").send({ workOrderId: subWorkOrderId, quantity: 5, lotId: subLotId })).expect(201);
    await auth(api().post(`/lots/${subLotId}/acceptance`).send({ status: "ACCEPTED" })).expect(201);

    // Seviye 2: TOP parçası için iş emri — SUB'ı alt montaj (itemType=PART) olarak tüketir.
    topWorkOrderId = (await auth(api().post("/work-orders").send({ partId: topPartId, quantity: 2, dueDate: DUE })).expect(201)).body.id;
    await auth(api().post("/consumptions").send({
      workOrderId: topWorkOrderId,
      itemType: "PART",
      itemId: subPartId,
      type: "CONSUMED",
      quantity: 5,
      lotId: subLotId,
    })).expect(201);
    topLotId = (await auth(api().post("/lots").send({
      lotNo: `TRACE3-TOP-LOT-${STAMP}`,
      itemType: "PART",
      itemId: topPartId,
    })).expect(201)).body.id;
    await auth(api().post("/finished-goods").send({ workOrderId: topWorkOrderId, quantity: 2, lotId: topLotId })).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("hammadde lotundan forward trace 2 seviye yukarı çıkar (SUB → TOP)", async () => {
    const trace = await auth(api().get(`/lots/${materialLotId}/trace`)).expect(200);
    const level1 = trace.body.forward.consumedByWorkOrders[0];
    expect(level1.workOrder.id).toBe(subWorkOrderId);
    const producedSubLot = level1.producedLots.find((p: { lot: { id: string } | null }) => p.lot?.id === subLotId);
    expect(producedSubLot).toBeTruthy();

    const level2 = producedSubLot.forward.consumedByWorkOrders[0];
    expect(level2.workOrder.id).toBe(topWorkOrderId);
    const producedTopLot = level2.producedLots.find((p: { lot: { id: string } | null }) => p.lot?.id === topLotId);
    expect(producedTopLot).toBeTruthy();
  });

  it("üst montaj lotundan backward trace 2 seviye aşağı iner (TOP → SUB → hammadde)", async () => {
    const trace = await auth(api().get(`/lots/${topLotId}/trace`)).expect(200);
    const level1 = trace.body.backward.producedByWorkOrders[0];
    expect(level1.workOrder.id).toBe(topWorkOrderId);
    const consumedSub = level1.consumedLots.find((c: { lot: { id: string } | null }) => c.lot?.id === subLotId);
    expect(consumedSub).toBeTruthy();
    expect(consumedSub.itemType).toBe("PART");

    const level2 = consumedSub.backward.producedByWorkOrders[0];
    expect(level2.workOrder.id).toBe(subWorkOrderId);
    const consumedMaterial = level2.consumedLots.find((c: { lot: { id: string } | null }) => c.lot?.id === materialLotId);
    expect(consumedMaterial).toBeTruthy();
    expect(consumedMaterial.itemType).toBe("MATERIAL");
    // Hammadde lotunun kendi backward'ı yok (üreten bir iş emri yok, satın alınan lot).
    expect(consumedMaterial.backward).toBeNull();
  });

  it("seri numarası trace()'i de alt montaj zincirine recursive iner", async () => {
    const serial = (await auth(api().post("/serial-numbers").send({
      serialNo: `TRACE3-SN-${STAMP}`,
      partId: topPartId,
      workOrderId: topWorkOrderId,
      lotId: topLotId,
    })).expect(201)).body;

    const trace = await auth(api().get(`/serial-numbers/${serial.id}/trace`)).expect(200);
    expect(trace.body.producedByWorkOrder.id).toBe(topWorkOrderId);
    const consumedSub = trace.body.producedByWorkOrder.consumptions.find(
      (c: { lot: { id: string } | null }) => c.lot?.id === subLotId,
    );
    expect(consumedSub).toBeTruthy();
    const level2 = consumedSub.backward.producedByWorkOrders[0];
    expect(level2.workOrder.id).toBe(subWorkOrderId);
    expect(level2.consumedLots.map((c: { lot: { id: string } | null }) => c.lot?.id)).toContain(materialLotId);
  });
});
