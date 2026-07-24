import { describe, expect, it } from "vitest";
import { quoteTotal } from "./quotes";

describe("quoteTotal", () => {
  it("satır tutarlarını toplar (Decimal alanları string gelir)", () => {
    expect(
      quoteTotal([
        { quantity: "10", unitPrice: "250.50" },
        { quantity: "5", unitPrice: "300" },
      ]),
    ).toBe(4005);
  });

  it("satır yoksa sıfır döner", () => {
    expect(quoteTotal([])).toBe(0);
  });
});
