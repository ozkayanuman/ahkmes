import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Varsayılan rapor aralığı: veri girilmezse son 7 gün (shift-report'un
 * varsayılan "bugün" aralığından farklı — işçilik özeti daha uzun bir pencere
 * için anlamlı, günlük değil). */
function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  return { from, to };
}

function parseRange(fromRaw?: string, toRaw?: string) {
  const def = defaultRange();
  const from = fromRaw ? new Date(`${fromRaw}T00:00:00`) : def.from;
  const to = toRaw ? new Date(`${toRaw}T23:59:59`) : def.to;
  return {
    from: Number.isNaN(from.getTime()) ? def.from : from,
    to: Number.isNaN(to.getTime()) ? def.to : to,
  };
}

@Injectable()
export class LaborService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Faz H Labor Tracking: operatör bazında toplam çalışma süresi ve işçilik
   * maliyeti — yeni bir zaman-çizelgesi/clock-in modeli EKLEMEZ, mevcut
   * ProductionRun (operatorId + startedAt/endedAt) verisini operatöre göre
   * gruplar (roadmap notu: "mevcut OEE/operatör verisiyle birleşir"). hourlyRate
   * girilmemiş operatörler için `laborCost` hesaplanmaz, `partial` işaretlenir.
   */
  async summary(tenantId: string, fromRaw?: string, toRaw?: string) {
    const { from, to } = parseRange(fromRaw, toRaw);

    const runs = await this.prisma.productionRun.findMany({
      where: { tenantId, startedAt: { gte: from, lte: to } },
      include: { operator: { select: { id: true, name: true, department: true, hourlyRate: true } } },
    });

    const byOperator = new Map<
      string,
      {
        operatorId: string;
        operatorName: string;
        department: string | null;
        hours: number;
        goodCount: number;
        scrapCount: number;
        laborCost: number;
        laborCostPartial: boolean;
      }
    >();

    for (const r of runs) {
      const end = r.endedAt ?? new Date();
      const hours = Math.max(0, (end.getTime() - r.startedAt.getTime()) / 1000 / 3600);

      const entry = byOperator.get(r.operatorId) ?? {
        operatorId: r.operatorId,
        operatorName: r.operator.name,
        department: r.operator.department,
        hours: 0,
        goodCount: 0,
        scrapCount: 0,
        laborCost: 0,
        laborCostPartial: false,
      };
      entry.hours += hours;
      entry.goodCount += r.goodCount;
      entry.scrapCount += r.scrapCount;
      if (r.operator.hourlyRate === null) {
        entry.laborCostPartial = true;
      } else {
        entry.laborCost += hours * Number(r.operator.hourlyRate);
      }
      byOperator.set(r.operatorId, entry);
    }

    const rows = [...byOperator.values()].sort((a, b) => b.hours - a.hours);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      operators: rows,
      totalHours: rows.reduce((sum, r) => sum + r.hours, 0),
      totalLaborCost: rows.reduce((sum, r) => sum + r.laborCost, 0),
    };
  }
}
