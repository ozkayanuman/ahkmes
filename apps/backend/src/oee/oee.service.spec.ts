import { OeeService } from "./oee.service";

describe("OeeService", () => {
  it("delegates an explicit calculation context to the canonical calculation authority", async () => {
    const result = { metrics: { oee: { value: 0.75 } } };
    const calculation = { calculate: jest.fn().mockResolvedValue(result) };
    const service = new OeeService({} as never, calculation as never);
    const request = {
      tenantId: "tenant-1",
      plantId: "plant-1",
      from: new Date("2026-08-26T05:00:00.000Z"),
      to: new Date("2026-08-26T09:00:00.000Z"),
      asOf: new Date("2026-08-26T09:00:00.000Z"),
    };

    await expect(service.calculate(request)).resolves.toBe(result);
    expect(calculation.calculate).toHaveBeenCalledWith(request);
  });
});
