import { BadRequestException } from "@nestjs/common";
import { ShiftReportController } from "./shift-report.controller";

const user = { userId: "u1", tenantId: "tenant-1", email: "x@y.z", name: "User", role: "ADMIN" as const, pages: "*" as const, locale: "tr", timezone: "Europe/Istanbul", authSource: "LOCAL" as const, oidcProviderId: null };

describe("ShiftReportController", () => {
  it("requires plant, production date and cutoff before requesting a canonical shift projection", async () => {
    const service = { report: jest.fn().mockResolvedValue([]) };
    const controller = new ShiftReportController(service as never);

    await controller.report(user, "plant-1", "2026-08-27", "2026-08-27T12:00:00.000Z");

    expect(service.report).toHaveBeenCalledWith({ tenantId: "tenant-1", plantId: "plant-1", productionDate: "2026-08-27", asOf: new Date("2026-08-27T12:00:00.000Z") });
    expect(() => controller.report(user, undefined, "2026-08-27", "2026-08-27T12:00:00.000Z")).toThrow(BadRequestException);
  });
});
