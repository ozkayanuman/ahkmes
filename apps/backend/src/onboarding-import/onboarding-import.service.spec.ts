import { ConflictException } from "@nestjs/common";
import { OnboardingImportService } from "./onboarding-import.service";

describe("OnboardingImportService", () => {
  it("exports only row errors and neutralizes spreadsheet formulas", async () => {
    const service = new OnboardingImportService({} as never, {} as never);
    jest.spyOn(service, "findOne").mockResolvedValue({
      id: "batch-1",
      rowResults: [
        { rowNumber: 2, externalKey: "PART-1", status: "VALID", errors: null },
        { rowNumber: 3, externalKey: "+unsafe", status: "ERROR", errors: ["=dangerous formula", "unit zorunludur"] },
      ],
    } as never);

    const csv = await service.errorCsv("tenant-1", "batch-1");

    expect(csv).toContain("satır,iş_anahtarı,hatalar");
    expect(csv).toContain("3,'+unsafe");
    expect(csv).toContain("'=dangerous formula");
    expect(csv).not.toContain("PART-1");
  });

  it("records a controlled rejection when a validated batch loses a uniqueness race", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      $transaction: jest.fn().mockRejectedValue({ code: "P2002" }),
      onboardingImportBatch: { updateMany },
    };
    const service = new OnboardingImportService(prisma as never, {} as never);
    jest.spyOn(service, "findOne").mockResolvedValue({
      id: "batch-1", status: "VALIDATED", validRows: 1, totalRows: 1, template: "TOOL_MACHINE_COMPATIBILITIES", rowResults: [],
    } as never);

    await expect(service.commit("tenant-1", "user-1", "batch-1")).rejects.toThrow(ConflictException);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "batch-1", tenantId: "tenant-1", status: "VALIDATED" },
      data: expect.objectContaining({ status: "REJECTED", failureReason: expect.stringContaining("eşzamanlı") }),
    }));
  });
});
