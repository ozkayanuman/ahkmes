import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { WorkOrderStatus } from "@prisma/client";
import type { CreateWorkOrderDto, ScheduleWorkOrderDto, UpdateWorkOrderDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { nextDocNo } from "../common/numbering";

const TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  PLANNED: ["WAITING_MATERIAL", "IN_PRODUCTION", "CANCELLED"],
  WAITING_MATERIAL: ["PLANNED", "IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const WO_INCLUDE = {
  part: { select: { id: true, partNo: true, revision: true, name: true } },
  machine: { select: { id: true, name: true } },
  quoteLine: {
    select: {
      id: true,
      quote: {
        select: { id: true, quoteNo: true, customer: { select: { id: true, name: true } } },
      },
    },
  },
} as const;

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * OEE (Overall Equipment Effectiveness) — yalnızca gerçek veriden hesaplanabilen
   * kısımlar döner. Quality her zaman hesaplanır. Performance yalnızca Part'ta
   * `idealCycleTimeSec` girilmişse hesaplanır (yoksa null — sahte sayı üretilmez).
   * Availability, koşunun bağlı olduğu makinedeki ALARM olaylarının (MachineStatusEvent)
   * koşu süresi içindeki toplam süresinden hesaplanır. Koşu bir makineye bağlı değilse
   * (manuel giriş) availability null kalır ve OEE formülünde çarpan olarak devre dışı
   * bırakılır (1 kabul edilir) — ölçülemeyen bir şey için ceza uygulanmaz.
   */
  async oee(tenantId: string, workOrderId: string) {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, tenantId },
      include: { part: { select: { idealCycleTimeSec: true } } },
    });
    if (!wo) throw new NotFoundException("İş emri bulunamadı");

    const runs = await this.prisma.productionRun.findMany({ where: { tenantId, workOrderId } });
    const goodCount = runs.reduce((sum, r) => sum + r.goodCount, 0);
    const scrapCount = runs.reduce((sum, r) => sum + r.scrapCount, 0);
    const totalCount = goodCount + scrapCount;
    const quality = totalCount > 0 ? goodCount / totalCount : null;

    const runtimeSeconds = runs.reduce((sum, r) => {
      const end = r.endedAt ?? new Date();
      return sum + Math.max(0, (end.getTime() - r.startedAt.getTime()) / 1000);
    }, 0);

    const idealCycleTimeSec = wo.part.idealCycleTimeSec ? Number(wo.part.idealCycleTimeSec) : null;
    const performance =
      idealCycleTimeSec && runtimeSeconds > 0
        ? Math.min(1, (idealCycleTimeSec * goodCount) / runtimeSeconds)
        : null;

    const runsWithMachine = runs.filter((r): r is typeof r & { machineId: string } => !!r.machineId);
    let availability: number | null = null;
    if (runsWithMachine.length > 0 && runtimeSeconds > 0) {
      let downtimeSeconds = 0;
      for (const run of runsWithMachine) {
        const runEnd = run.endedAt ?? new Date();
        const events = await this.prisma.machineStatusEvent.findMany({
          where: { tenantId, machineId: run.machineId, occurredAt: { gte: run.startedAt, lte: runEnd } },
          orderBy: { occurredAt: "asc" },
        });
        for (let i = 0; i < events.length; i++) {
          if (events[i].type !== "ALARM") continue;
          const end = events[i + 1]?.occurredAt ?? runEnd;
          downtimeSeconds += Math.max(0, (end.getTime() - events[i].occurredAt.getTime()) / 1000);
        }
      }
      availability = Math.max(0, Math.min(1, 1 - downtimeSeconds / runtimeSeconds));
    }

    const oeeValue =
      quality !== null && performance !== null ? quality * performance * (availability ?? 1) : null;

    return {
      workOrderId,
      goodCount,
      scrapCount,
      quality,
      performance,
      availability,
      oee: oeeValue,
      note:
        performance === null
          ? "Performance/OEE hesaplanamadı: parçada ideal çevrim süresi (idealCycleTimeSec) tanımlı değil."
          : availability === null
            ? "Availability hesaplanamadı: koşu bir makineye bağlı değil (manuel giriş)."
            : undefined,
    };
  }

  /**
   * Genealogy (izlenebilirlik): bir iş emrinin tükettiği malzemeler (backward) ve
   * ürettiği mamul/koşu kayıtları (forward) — MTU/seri numarası bazlı değil, iş emri
   * granülaritesinde (mevcut veri modelinde serileştirilmiş birim takibi yok, bu
   * bilinçli bir kapsam sınırı).
   */
  async genealogy(tenantId: string, workOrderId: string) {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, tenantId },
      include: {
        part: { select: { id: true, partNo: true, revision: true, name: true } },
        quoteLine: {
          select: {
            id: true,
            quote: { select: { id: true, quoteNo: true, customer: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (!wo) throw new NotFoundException("İş emri bulunamadı");

    const [consumptions, productionRuns, finishedGoods] = await Promise.all([
      this.prisma.materialConsumption.findMany({
        where: { tenantId, workOrderId },
        include: { material: { select: { id: true, code: true, name: true } } },
        orderBy: { date: "asc" },
      }),
      this.prisma.productionRun.findMany({
        where: { tenantId, workOrderId },
        include: {
          machine: { select: { id: true, name: true } },
          operator: { select: { id: true, name: true } },
        },
        orderBy: { startedAt: "asc" },
      }),
      this.prisma.finishedGoodsEntry.findMany({
        where: { tenantId, workOrderId },
        orderBy: { date: "asc" },
      }),
    ]);

    return {
      workOrder: { id: wo.id, woNo: wo.woNo, status: wo.status, quantity: wo.quantity },
      part: wo.part,
      customer: wo.quoteLine?.quote.customer ?? null,
      quoteNo: wo.quoteLine?.quote.quoteNo ?? null,
      backward: { materialsConsumed: consumptions },
      forward: { productionRuns, finishedGoodsEntries: finishedGoods },
    };
  }

  /**
   * Faz G Cost Accounting + Faz H Labor Tracking: bir iş emrinin gerçekleşen
   * maliyeti — malzeme maliyeti (CONSUMED tüketimler × Material.standardCost) +
   * makine maliyeti (ProductionRun süresi × Machine.hourlyRate) + işçilik maliyeti
   * (ProductionRun süresi × operatörün User.hourlyRate'i). Üç bileşen de yalnızca
   * maliyet verisi girilmiş kalemler üzerinden hesaplanır; eksik veri sessizce
   * atlanmaz, `partial` bayrağıyla işaretlenir (sahte/tam sayı izlenimi verilmez).
   * Not: Faz G'de bu ikinci bileşen yanlışlıkla `laborCost` diye adlandırılmıştı
   * (aslında makine maliyetiydi) — Faz H'de gerçek operatör-bazlı işçilik eklenince
   * `machineCost` olarak düzeltildi, `laborCost` artık gerçekten işçilik demek.
   */
  async cost(tenantId: string, workOrderId: string) {
    const wo = await this.findOne(tenantId, workOrderId);

    const consumptions = await this.prisma.materialConsumption.findMany({
      where: { tenantId, workOrderId, type: "CONSUMED" },
      include: { material: { select: { id: true, code: true, name: true, standardCost: true } } },
    });
    let materialCost = 0;
    let materialCostPartial = false;
    for (const c of consumptions) {
      if (c.material.standardCost === null) {
        materialCostPartial = true;
        continue;
      }
      materialCost += Number(c.quantity) * Number(c.material.standardCost);
    }

    const runs = await this.prisma.productionRun.findMany({
      where: { tenantId, workOrderId },
      include: {
        machine: { select: { id: true, name: true, hourlyRate: true } },
        operator: { select: { id: true, name: true, hourlyRate: true } },
      },
    });
    let machineCost = 0;
    let machineCostPartial = false;
    let laborCost = 0;
    let laborCostPartial = false;
    for (const r of runs) {
      const end = r.endedAt ?? new Date();
      const hours = Math.max(0, (end.getTime() - r.startedAt.getTime()) / 1000 / 3600);

      if (!r.machine || r.machine.hourlyRate === null) {
        machineCostPartial = true;
      } else {
        machineCost += hours * Number(r.machine.hourlyRate);
      }

      if (r.operator.hourlyRate === null) {
        laborCostPartial = true;
      } else {
        laborCost += hours * Number(r.operator.hourlyRate);
      }
    }

    return {
      workOrderId: wo.id,
      materialCost,
      materialCostPartial,
      machineCost,
      machineCostPartial,
      laborCost,
      laborCostPartial,
      totalCost: materialCost + machineCost + laborCost,
      note:
        materialCostPartial || machineCostPartial || laborCostPartial
          ? "Bazı malzeme/makine/operatör kayıtlarında maliyet verisi (standardCost/hourlyRate) girilmediği için toplam maliyet eksiktir."
          : undefined,
    };
  }

  /** Basit Scheduling/Gantt: bir iş emrinin planlanan başlangıç/bitiş tarihini ayarlar. */
  async schedule(tenantId: string, id: string, dto: ScheduleWorkOrderDto) {
    await this.findOne(tenantId, id);
    const updated = await this.prisma.workOrder.update({
      where: { id },
      data: dto,
      include: WO_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id });
    return updated;
  }

  findAll(tenantId: string, status?: WorkOrderStatus, q?: string) {
    return this.prisma.workOrder.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { woNo: { contains: q, mode: "insensitive" as const } },
                { part: { partNo: { contains: q, mode: "insensitive" as const } } },
                { part: { name: { contains: q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: WO_INCLUDE,
      orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, tenantId },
      include: WO_INCLUDE,
    });
    if (!wo) throw new NotFoundException("İş emri bulunamadı");
    return wo;
  }

  async create(tenantId: string, dto: CreateWorkOrderDto) {
    const part = await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    if (dto.machineId) await this.ensureMachine(tenantId, dto.machineId);

    const created = await this.prisma.$transaction(async (tx) => {
      const woNo = await nextDocNo(tx, "workOrder", "woNo", "IE");
      return tx.workOrder.create({
        data: { ...dto, tenantId, woNo },
        include: WO_INCLUDE,
      });
    });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id: created.id });
    return created;
  }

  async update(tenantId: string, id: string, dto: UpdateWorkOrderDto) {
    const wo = await this.findOne(tenantId, id);
    if (wo.status === "COMPLETED" || wo.status === "CANCELLED") {
      throw new ConflictException("Tamamlanmış/iptal edilmiş iş emri düzenlenemez");
    }
    if ((dto.quantity !== undefined || dto.dueDate !== undefined) && wo.status !== "PLANNED") {
      throw new ConflictException("Miktar ve termin sadece PLANNED durumunda değişebilir");
    }
    if (dto.machineId) await this.ensureMachine(tenantId, dto.machineId);

    const updated = await this.prisma.workOrder.update({
      where: { id },
      data: dto,
      include: WO_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id });
    return updated;
  }

  async setStatus(tenantId: string, id: string, status: WorkOrderStatus) {
    const wo = await this.findOne(tenantId, id);
    if (!TRANSITIONS[wo.status].includes(status)) {
      throw new ConflictException(`Geçersiz durum geçişi: ${wo.status} → ${status}`);
    }
    const updated = await this.prisma.workOrder.update({
      where: { id },
      data: { status },
      include: WO_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id, status });
    return updated;
  }

  async remove(tenantId: string, id: string) {
    const wo = await this.findOne(tenantId, id);
    if (wo.status !== "PLANNED" && wo.status !== "CANCELLED") {
      throw new ConflictException("Sadece PLANNED veya CANCELLED iş emri silinebilir");
    }
    const deleted = await this.prisma.workOrder.delete({ where: { id } });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id, deleted: true });
    return deleted;
  }

  private async ensureMachine(tenantId: string, machineId: string) {
    const machine = await this.prisma.machine.findFirst({
      where: { id: machineId, tenantId, isActive: true },
    });
    if (!machine) throw new NotFoundException("Tezgah bulunamadı veya pasif");
  }
}
