import { mergeTenantWhere, stampRecord, TenantScopeViolationError } from "./tenant-scope.extension";

describe("tenant-scope.extension", () => {
  const TENANT = "11111111-1111-1111-1111-111111111111";
  const OTHER = "22222222-2222-2222-2222-222222222222";

  describe("mergeTenantWhere", () => {
    it("boş where'e tenantId ekler", () => {
      expect(mergeTenantWhere("WorkOrder", undefined, TENANT)).toEqual({ tenantId: TENANT });
    });

    it("mevcut filtreleri korurken tenantId ekler", () => {
      expect(mergeTenantWhere("WorkOrder", { id: "wo-1" }, TENANT)).toEqual({ id: "wo-1", tenantId: TENANT });
    });

    it("where'deki tenantId context ile eşleşiyorsa dokunmaz", () => {
      expect(mergeTenantWhere("WorkOrder", { tenantId: TENANT }, TENANT)).toEqual({ tenantId: TENANT });
    });

    it("where'deki tenantId context ile çelişirse fırlatır", () => {
      expect(() => mergeTenantWhere("WorkOrder", { tenantId: OTHER }, TENANT)).toThrow(TenantScopeViolationError);
    });
  });

  describe("stampRecord", () => {
    it("tenantId alanı olan modele tenantId damgalar", () => {
      const result = stampRecord("WorkOrder", { woNo: "WO-1", partId: "p1" }, TENANT) as Record<string, unknown>;
      expect(result.tenantId).toBe(TENANT);
      expect(result.woNo).toBe("WO-1");
    });

    it("çelişen tenantId ile fırlatır", () => {
      expect(() => stampRecord("WorkOrder", { woNo: "WO-1", tenantId: OTHER }, TENANT)).toThrow(TenantScopeViolationError);
    });

    it("nested create ilişkisini (WorkOrder.operations) recursive damgalar", () => {
      const result = stampRecord(
        "WorkOrder",
        {
          woNo: "WO-1",
          partId: "p1",
          operations: { create: [{ seq: 10, name: "Op1" }, { seq: 20, name: "Op2" }] },
        },
        TENANT,
      ) as Record<string, unknown>;
      const operations = result.operations as { create: Array<Record<string, unknown>> };
      expect(operations.create).toHaveLength(2);
      expect(operations.create[0].tenantId).toBe(TENANT);
      expect(operations.create[1].tenantId).toBe(TENANT);
      expect(operations.create[0].seq).toBe(10);
    });

    it("tenantId alanı olmayan ilişkisel (scalar/ilişkisiz) modelde model adı bulunamazsa dokunmadan bırakır", () => {
      const result = stampRecord("NonExistentModel", { foo: "bar" }, TENANT) as Record<string, unknown>;
      expect(result.foo).toBe("bar");
      expect(result.tenantId).toBeUndefined();
    });

    it("primitif/null değerleri olduğu gibi döner", () => {
      expect(stampRecord("WorkOrder", null, TENANT)).toBeNull();
      expect(stampRecord("WorkOrder", "x", TENANT)).toBe("x");
    });
  });
});
