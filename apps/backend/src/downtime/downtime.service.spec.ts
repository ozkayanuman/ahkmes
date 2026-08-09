import { Test } from "@nestjs/testing";
import { DowntimeService } from "./downtime.service";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";

describe("DowntimeService.pareto", () => {
  let service: DowntimeService;
  const findMany = jest.fn();

  beforeEach(async () => {
    findMany.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DowntimeService,
        { provide: PrismaService, useValue: { downtimeEvent: { findMany } } },
        { provide: OutboxService, useValue: { record: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(DowntimeService);
  });

  it("reason.label'a göre gruplar ve süreyi azalan sırada döner", async () => {
    findMany.mockResolvedValue([
      { startedAt: new Date("2026-08-01T10:00:00Z"), endedAt: new Date("2026-08-01T10:05:00Z"), reason: { label: "Mekanik arıza" } },
      { startedAt: new Date("2026-08-01T11:00:00Z"), endedAt: new Date("2026-08-01T11:20:00Z"), reason: { label: "Mekanik arıza" } },
      { startedAt: new Date("2026-08-02T09:00:00Z"), endedAt: new Date("2026-08-02T09:02:00Z"), reason: { label: "Malzeme bekleme" } },
    ]);

    const result = await service.pareto("tenant-1", 7);

    expect(result).toEqual([
      { reason: "Mekanik arıza", totalSeconds: 1500, count: 2 },
      { reason: "Malzeme bekleme", totalSeconds: 120, count: 1 },
    ]);
  });

  it("reasonId=null kayıtları 'Sınıflandırılmamış' altında toplar", async () => {
    findMany.mockResolvedValue([
      { startedAt: new Date("2026-08-01T10:00:00Z"), endedAt: new Date("2026-08-01T10:10:00Z"), reason: null },
    ]);

    const result = await service.pareto("tenant-1", 7);

    expect(result).toEqual([{ reason: "Sınıflandırılmamış", totalSeconds: 600, count: 1 }]);
  });

  it("tenantId ve gün penceresini prisma sorgusuna doğru geçirir", async () => {
    findMany.mockResolvedValue([]);
    await service.pareto("tenant-9", 30);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-9", endedAt: expect.objectContaining({ not: null }) }),
      }),
    );
  });
});
