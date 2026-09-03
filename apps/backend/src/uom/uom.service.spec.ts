import { BadRequestException } from "@nestjs/common";
import { UomService } from "./uom.service";

function prisma() {
  const units = new Map<string, any>();
  return {
    uomDefinition: {
      createMany: jest.fn(async ({ data }: any) => { for (const item of data) { const key = `${item.tenantId}:${item.code}`; if (!units.has(key)) units.set(key, item); } return { count: data.length }; }),
      findFirst: jest.fn(async ({ where }: any) => units.get(`${where.tenantId}:${where.code}`) ?? null),
      findMany: jest.fn(async () => [...units.values()]),
      create: jest.fn(async ({ data }: any) => { units.set(`${data.tenantId}:${data.code}`, data); return data; }),
    },
  };
}

describe("UomService", () => {
  it("converts decimal quantities deterministically within a dimension", async () => {
    const service = new UomService(prisma() as any);
    await expect(service.convert("t1", { quantity: 1000, fromCode: "G", toCode: "KG" })).resolves.toMatchObject({ quantity: "1.000000", dimension: "MASS" });
    await expect(service.convert("t1", { quantity: 60, fromCode: "MIN", toCode: "H" })).resolves.toMatchObject({ quantity: "1.000000", dimension: "TIME" });
  });
  it("rejects incompatible dimensions", async () => {
    const service = new UomService(prisma() as any);
    await expect(service.convert("t1", { quantity: 1, fromCode: "KG", toCode: "MM" })).rejects.toBeInstanceOf(BadRequestException);
  });
  it("uses PostgreSQL upsert semantics for idempotent system-unit provisioning", async () => {
    const client = prisma() as any;
    await new UomService(client).ensureSystemUnits("t1");
    await new UomService(client).ensureSystemUnits("t1");
    expect(client.uomDefinition.createMany).toHaveBeenCalledTimes(2);
  });
});
