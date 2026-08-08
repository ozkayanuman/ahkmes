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
