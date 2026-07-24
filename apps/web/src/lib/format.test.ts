import { describe, expect, it } from "vitest";
import { fmtDate, fmtMoney, fmtQty, todayInput } from "./format";

describe("format yardımcıları", () => {
  it("fmtDate — ISO tarihi tr-TR biçiminde verir, boşsa tire", () => {
    expect(fmtDate("2026-03-09T00:00:00.000Z")).toBe(
      new Date("2026-03-09T00:00:00.000Z").toLocaleDateString("tr-TR"),
    );
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
  });

  it("fmtMoney — Decimal string'i para birimiyle biçimler", () => {
    // Prisma Decimal alanları API'den string gelir
    expect(fmtMoney("1234.5")).toContain("1.234,5");
    expect(fmtMoney(1234.5, "USD")).toContain("1.234,5");
  });

  it("fmtQty — en fazla 3 ondalık gösterir", () => {
    expect(fmtQty("10.000")).toBe("10");
    expect(fmtQty("10.5")).toBe("10,5");
    expect(fmtQty(0)).toBe("0");
  });

  it("todayInput — <input type=date> için YYYY-MM-DD verir", () => {
    expect(todayInput()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
