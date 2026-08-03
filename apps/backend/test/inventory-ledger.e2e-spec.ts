import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("AHK-003 — immutable inventory ledger (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let materialId: string;
  let supplierId: string;
  let poId: string;
  let fromBinId: string;
  let toBinId: string;

  const api = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const login = await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = login.body.accessToken;

    const warehouse = await auth(api().post("/warehouses").send({ name: `Ledger WH ${STAMP}`, code: `LDG${STAMP}` })).expect(201);
    fromBinId = (await auth(api().post("/bins").send({ warehouseId: warehouse.body.id, code: "A" })).expect(201)).body.id;
    toBinId = (await auth(api().post("/bins").send({ warehouseId: warehouse.body.id, code: "B" })).expect(201)).body.id;
    materialId = (await auth(api().post("/materials").send({ code: `LEDGER-MAT-${STAMP}`, name: "Ledger material", type: "RAW", unit: "kg" })).expect(201)).body.id;
    supplierId = (await auth(api().post("/suppliers").send({ name: `Ledger supplier ${STAMP}` })).expect(201)).body.id;
  });

  afterAll(async () => app.close());

  it("receipt → transfer → count maintains projections and appends movements", async () => {
    const po = await auth(api().post("/purchase-orders").send({
      supplierId,
      orderDate: new Date().toISOString(),
      lines: [{ materialId, quantity: 10, unitPrice: 2 }],
    })).expect(201);
    poId = po.body.id;
    await auth(api().post(`/purchase-orders/${poId}/receive`).send({
      lines: [{ lineId: po.body.lines[0].id, receivedQty: 10, binId: fromBinId }],
    })).expect(201);

    let movements = await auth(api().get(`/inventory/movements?itemId=${materialId}`)).expect(200);
    expect(movements.body).toHaveLength(1);
    expect(movements.body[0]).toMatchObject({ movementType: "PURCHASE_RECEIPT", quantityDelta: "10", binId: fromBinId });
    expect(Number((await auth(api().get(`/bins/${fromBinId}/balances`)).expect(200)).body[0].qty)).toBe(10);

    await auth(api().post("/transfer-orders").send({
      fromBinId, toBinId, lines: [{ itemType: "MATERIAL", itemId: materialId, qty: 4 }],
    })).expect(201);
    const materialAfterTransfer = await auth(api().get(`/materials/${materialId}`)).expect(200);
    expect(Number(materialAfterTransfer.body.stockQty)).toBe(10);
    expect(Number((await auth(api().get(`/bins/${fromBinId}/balances`)).expect(200)).body[0].qty)).toBe(6);
    expect(Number((await auth(api().get(`/bins/${toBinId}/balances`)).expect(200)).body[0].qty)).toBe(4);

    const count = await auth(api().post("/cycle-counts").send({
      binId: toBinId, lines: [{ itemType: "MATERIAL", itemId: materialId, countedQty: 3 }],
    })).expect(201);
    await auth(api().patch(`/cycle-counts/${count.body.id}/post`).send({})).expect(200);
    const materialAfterCount = await auth(api().get(`/materials/${materialId}`)).expect(200);
    expect(Number(materialAfterCount.body.stockQty)).toBe(9);
    expect(Number((await auth(api().get(`/bins/${toBinId}/balances`)).expect(200)).body[0].qty)).toBe(3);

    movements = await auth(api().get(`/inventory/movements?itemId=${materialId}`)).expect(200);
    expect(movements.body.map((m: { movementType: string }) => m.movementType).sort()).toEqual([
      "CYCLE_COUNT_ADJUSTMENT", "PURCHASE_RECEIPT", "TRANSFER_IN", "TRANSFER_OUT",
    ]);
    await expect(prisma.inventoryMovement.delete({ where: { id: movements.body[0].id } })).rejects.toThrow();
  });
});
