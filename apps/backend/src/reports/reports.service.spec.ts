import { ReportsService } from "./reports.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    workOrder: { findMany: jest.fn().mockResolvedValue([]) },
    nonConformance: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const service = new ReportsService(prisma as any);
  return { service, prisma };
}

describe("ReportsService.workOrdersCsv", () => {
  it("satırları CSV'ye çevirir, başlık satırı doğru kolonları içerir", async () => {
    const { service, prisma } = buildService();
    prisma.workOrder.findMany.mockResolvedValue([
      {
        woNo: "IE-2026-0001",
        part: { partNo: "P1", name: "Mil" },
        quantity: "10",
        status: "PLANNED",
        machine: { name: "CNC-1" },
        dueDate: new Date("2026-08-01T00:00:00Z"),
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
    ]);

    const csv = await service.workOrdersCsv("t1");

    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("İş Emri No,Parça No,Parça Adı,Miktar,Durum,Makine,Termin Tarihi,Oluşturulma");
    expect(lines[1]).toContain("IE-2026-0001");
    expect(lines[1]).toContain("CNC-1");
  });

  it("makine atanmamışsa boş hücre, hata fırlatmaz", async () => {
    const { service, prisma } = buildService();
    prisma.workOrder.findMany.mockResolvedValue([
      {
        woNo: "IE-2026-0002",
        part: { partNo: "P2", name: "Gövde" },
        quantity: "5",
        status: "PLANNED",
        machine: null,
        dueDate: new Date(),
        createdAt: new Date(),
      },
    ]);

    const csv = await service.workOrdersCsv("t1");

    expect(csv).toContain("IE-2026-0002");
  });

  it("virgül/tırnak içeren değer RFC 4180'e göre tırnaklanır", async () => {
    const { service, prisma } = buildService();
    prisma.workOrder.findMany.mockResolvedValue([
      {
        woNo: "IE-2026-0003",
        part: { partNo: "P3", name: 'Kapak, "Özel"' },
        quantity: "1",
        status: "PLANNED",
        machine: null,
        dueDate: new Date(),
        createdAt: new Date(),
      },
    ]);

    const csv = await service.workOrdersCsv("t1");

    expect(csv).toContain('"Kapak, ""Özel"""');
  });
});

describe("ReportsService.nonConformancesCsv", () => {
  it("resolvedBy null ise boş hücre döner", async () => {
    const { service, prisma } = buildService();
    prisma.nonConformance.findMany.mockResolvedValue([
      {
        workOrder: { woNo: "IE-2026-0001" },
        failureType: "SCRAP",
        actionType: "GENERIC",
        status: "OPEN",
        reportedBy: { name: "Ali" },
        resolvedBy: null,
        description: null,
        resolutionNote: null,
        createdAt: new Date(),
        resolvedAt: null,
      },
    ]);

    const csv = await service.nonConformancesCsv("t1");

    const dataLine = csv.split("\r\n")[1];
    expect(dataLine.split(",")[0]).toBe("IE-2026-0001");
  });
});
