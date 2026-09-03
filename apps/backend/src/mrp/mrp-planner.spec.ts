import { mrpLotSize } from "./mrp.service";

describe("CNC-V1-03R lot sizing", () => {
  it("uses lot-for-lot without a hidden rounding adjustment", () => {
    expect(mrpLotSize(17.125, { lotSizingRule: "LOT_FOR_LOT", minimumQuantity: null, orderMultiple: null })).toBe(17.125);
  });

  it("applies minimum quantity and order multiple deterministically", () => {
    const parameter = { lotSizingRule: "ORDER_MULTIPLE", minimumQuantity: "20", orderMultiple: "5" };
    expect(mrpLotSize(17, parameter)).toBe(20);
    expect(mrpLotSize(23, parameter)).toBe(25);
  });

  it("rounds fixed lots upward using decimal-safe six-place output", () => {
    expect(mrpLotSize(2.1, { lotSizingRule: "FIXED_LOT_SIZE", fixedLotSize: "2.5" })).toBe(2.5);
    expect(mrpLotSize(2.500001, { lotSizingRule: "FIXED_LOT_SIZE", fixedLotSize: "2.5" })).toBe(5);
  });
});
