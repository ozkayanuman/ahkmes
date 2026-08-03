import { describe, expect, it } from "vitest";
import {
  createCustomerSchema,
  createMaterialSchema,
  createQuoteSchema,
  createUserSchema,
  loginSchema,
  RoleSchema,
  RunSourceSchema,
  createToolDefinitionSchema,
  createToolCompatibilitySchema,
  manualToolLifeAdjustmentSchema,
  setupAssignmentSchema,
} from "./index";

describe("enum şemaları", () => {
  it("geçerli rolleri kabul eder", () => {
    expect(RoleSchema.parse("ADMIN")).toBe("ADMIN");
    expect(RoleSchema.parse("OPERATOR")).toBe("OPERATOR");
  });

  it("geçersiz rolü reddeder", () => {
    expect(() => RoleSchema.parse("SUPERUSER")).toThrow();
  });

  it("RunSource MANUAL ve MACHINE değerlerini tanır", () => {
    expect(RunSourceSchema.options).toEqual(["MANUAL", "MACHINE"]);
  });
});

describe("loginSchema", () => {
  it("geçerli girişi kabul eder", () => {
    const result = loginSchema.parse({ email: "a@b.co", password: "12345678" });
    expect(result.email).toBe("a@b.co");
  });

  it("kısa şifreyi reddeder", () => {
    expect(() => loginSchema.parse({ email: "a@b.co", password: "123" })).toThrow();
  });
});

describe("createUserSchema", () => {
  it("varsayılan isActive=true atar", () => {
    const u = createUserSchema.parse({
      email: "op@ahkmes.local",
      password: "12345678",
      name: "Operatör",
      role: "OPERATOR",
    });
    expect(u.isActive).toBe(true);
  });
});

describe("createCustomerSchema", () => {
  it("sadece isimle müşteri oluşturur", () => {
    expect(createCustomerSchema.parse({ name: "AHK Makina" }).name).toBe("AHK Makina");
  });

  it("boş ismi reddeder", () => {
    expect(() => createCustomerSchema.parse({ name: "" })).toThrow();
  });
});

describe("createMaterialSchema", () => {
  it("string miktarı sayıya çevirir", () => {
    const m = createMaterialSchema.parse({
      code: "AL6061",
      name: "Alüminyum 6061 çubuk",
      type: "RAW",
      unit: "kg",
      minStock: "12.5",
    });
    expect(m.minStock).toBe(12.5);
  });
});

describe("createQuoteSchema", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  it("en az bir satır ister", () => {
    expect(() =>
      createQuoteSchema.parse({ customerId: uuid, lines: [] }),
    ).toThrow();
  });

  it("satırlı teklifi kabul eder ve tarihi Date'e çevirir", () => {
    const q = createQuoteSchema.parse({
      customerId: uuid,
      lines: [{ partId: uuid, quantity: 10, unitPrice: "150.75", dueDate: "2026-08-15" }],
    });
    expect(q.currency).toBe("TRY");
    expect(q.lines[0].dueDate).toBeInstanceOf(Date);
    expect(q.lines[0].unitPrice).toBe(150.75);
  });

  it("sıfır miktarı reddeder", () => {
    expect(() =>
      createQuoteSchema.parse({
        customerId: uuid,
        lines: [{ partId: uuid, quantity: 0, unitPrice: 1, dueDate: "2026-08-15" }],
      }),
    ).toThrow();
  });
});

describe("MES-TOOL-001 tooling DTO guards", () => {
  it("rejects invalid life policies and unsafe thresholds", () => {
    expect(createToolDefinitionSchema.safeParse({ code: "T1", name: "Tool", toolType: "END_MILL", lifePolicy: "BAD", maximumLife: 5, warningThreshold: 1, lifeUnit: "cycle" }).success).toBe(false);
    expect(createToolDefinitionSchema.safeParse({ code: "T1", name: "Tool", toolType: "END_MILL", lifePolicy: "CYCLE", maximumLife: 5, warningThreshold: 6, lifeUnit: "cycle" }).success).toBe(false);
  });

  it("requires one compatibility subject, unique assignments and an adjustment reason", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(createToolCompatibilitySchema.safeParse({ machineId: id }).success).toBe(false);
    expect(setupAssignmentSchema.safeParse({ toolAssignments: [{ requirementId: id, physicalToolInstanceId: id }, { requirementId: "00000000-0000-4000-8000-000000000002", physicalToolInstanceId: id }] }).success).toBe(false);
    expect(manualToolLifeAdjustmentSchema.safeParse({ consumedLife: 1, version: 1, reason: "" }).success).toBe(false);
  });
});
