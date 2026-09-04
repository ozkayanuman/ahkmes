import { BadRequestException } from "@nestjs/common";
import { OeeController } from "./oee.controller";

const user = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "oee@test.local",
  name: "OEE Admin",
  role: "ADMIN" as const,
  pages: "*" as const,
  locale: "tr",
  timezone: "Europe/Istanbul",
  authSource: "LOCAL" as const,
  oidcProviderId: null,
};

describe("OeeController", () => {
  it("requires an explicit plant, range and cutoff before delegating to the canonical authority", async () => {
    const service = { calculate: jest.fn().mockResolvedValue({ metrics: {} }) };
    const controller = new OeeController(service as never);

    await controller.calculate(user, "plant-1", "2026-08-26T05:00:00.000Z", "2026-08-26T09:00:00.000Z", "2026-08-26T09:00:00.000Z");

    expect(service.calculate).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      plantId: "plant-1",
      from: new Date("2026-08-26T05:00:00.000Z"),
      to: new Date("2026-08-26T09:00:00.000Z"),
      asOf: new Date("2026-08-26T09:00:00.000Z"),
    });
  });

  it("rejects a calculation request without a complete explicit context", () => {
    const controller = new OeeController({ calculate: jest.fn() } as never);

    expect(() => controller.calculate(user, undefined, "2026-08-26T05:00:00.000Z", "2026-08-26T09:00:00.000Z", "2026-08-26T09:00:00.000Z")).toThrow(BadRequestException);
  });

  it("requires the same explicit context for trend and Pareto projections", async () => {
    const service = { trend: jest.fn().mockResolvedValue([]), downtimePareto: jest.fn().mockResolvedValue([]) };
    const controller = new OeeController(service as never);
    const context = ["plant-1", "2026-08-26T05:00:00.000Z", "2026-08-26T09:00:00.000Z", "2026-08-26T09:00:00.000Z"] as const;
    const expected = {
      tenantId: "tenant-1",
      plantId: "plant-1",
      from: new Date("2026-08-26T05:00:00.000Z"),
      to: new Date("2026-08-26T09:00:00.000Z"),
      asOf: new Date("2026-08-26T09:00:00.000Z"),
    };

    await controller.trend(user, ...context);
    await controller.downtimePareto(user, ...context);

    expect(service.trend).toHaveBeenCalledWith(expected);
    expect(service.downtimePareto).toHaveBeenCalledWith(expected);
    expect(() => controller.trend(user, "plant-1", undefined, context[2], context[3])).toThrow(BadRequestException);
    expect(() => controller.downtimePareto(user, "plant-1", context[1], context[2], undefined)).toThrow(BadRequestException);
  });
});
