import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, WorkOrderStatus } from "@prisma/client";
import type {
  CompleteWorkOrderOperationDto,
  CreateWorkOrderDto,
  ScheduleWorkOrderDto,
  UpdateWorkOrderDto,
  UpdateWorkOrderOperationDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { nextDocNo } from "../common/numbering";
import { PartsService } from "../parts/parts.service";
import { ToolingService } from "../tooling/tooling.service";

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
  operations: {
    include: { machine: { select: { id: true, name: true } }, ncProgram: { select: { id: true, version: true, status: true, fileName: true, checksum: true, effectivityScope: true } } },
    orderBy: { seq: "asc" as const },
  },
} as const;

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly parts?: PartsService,
    private readonly tooling?: ToolingService,
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
    const updated = await this.prisma.workOrder.updateMany({
      where: { id, tenantId },
      data: dto,
    });
    if (updated.count === 0) throw new NotFoundException("İş emri bulunamadı");
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id });
    return this.findOne(tenantId, id);
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
    const created = await this.prisma.$transaction((tx) => this.createInTransaction(tx, tenantId, dto));
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id: created.id });
    return created;
  }

  /** MRP gibi üst command'lerin WO ve karar kayıtlarını aynı transaction'a alması için. */
  async createInTransaction(tx: Prisma.TransactionClient, tenantId: string, dto: CreateWorkOrderDto) {
    const part = await tx.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    if (dto.machineId) await this.ensureMachine(tenantId, dto.machineId, tx);
    const woNo = await nextDocNo(tx, "workOrder", "woNo", "IE");
    return this.createWithRoute(tx, tenantId, { ...dto, woNo });
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

    const updated = await this.prisma.workOrder.updateMany({
      where: { id, tenantId },
      data: dto,
    });
    if (updated.count === 0) throw new NotFoundException("İş emri bulunamadı");
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id });
    return this.findOne(tenantId, id);
  }

  async setStatus(tenantId: string, id: string, status: WorkOrderStatus) {
    const wo = await this.findOne(tenantId, id);
    if (!TRANSITIONS[wo.status].includes(status)) {
      throw new ConflictException(`Geçersiz durum geçişi: ${wo.status} → ${status}`);
    }
    if (status === "COMPLETED" && wo.operations.some((operation) => operation.status !== "COMPLETED" && operation.status !== "SKIPPED")) {
      throw new ConflictException("Rotalı iş emri, tüm operasyonları tamamlanmadan kapatılamaz");
    }
    const updated = await this.prisma.workOrder.updateMany({
      where: { id, tenantId, status: wo.status },
      data: { status },
    });
    if (updated.count === 0) throw new ConflictException("İş emri durumu eşzamanlı değişti; tekrar deneyin");
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id, status });
    return this.findOne(tenantId, id);
  }

  /** SalesOrder.release gibi başka application servislerinin aynı transaction
   * içinde çağırdığı tek iş emri + rota snapshot oluşturma sınırı. */
  async createWithRoute(
    tx: Prisma.TransactionClient,
    tenantId: string,
    data: Omit<Prisma.WorkOrderUncheckedCreateInput, "tenantId">,
  ) {
    const recipe = await tx.recipeHeader.findFirst({
      where: { tenantId, partId: data.partId, isActive: true },
      include: { steps: { orderBy: { seq: "asc" } } },
    });
    const ncSnapshots = new Map<string, Awaited<ReturnType<PartsService["assertNcProgramUsable"]>>>();
    if (recipe) {
      for (const step of recipe.steps) {
        if (step.ncProgramId) ncSnapshots.set(step.ncProgramId, await this.ncPrograms().assertNcProgramUsable(tenantId, step.ncProgramId, data.partId, data.machineId, undefined, tx));
      }
    }
    const created = await tx.workOrder.create({
      data: {
        ...data,
        tenantId,
        ...(recipe
          ? {
              recipeHeaderId: recipe.id,
              recipeRevision: recipe.revision,
              routeSnapshotAt: new Date(),
              operations: {
                create: recipe.steps.map((step) => ({
                  tenantId,
                  seq: step.seq,
                  name: step.name,
                  parameterName: step.parameterName,
                  parameterValue: step.parameterValue,
                  unit: step.unit,
                  machineId: data.machineId ?? undefined,
                  ...(step.ncProgramId
                    ? (() => {
                        const program = ncSnapshots.get(step.ncProgramId)!;
                        return { ncProgramId: program.id, ncProgramVersion: program.version, ncProgramChecksum: program.checksum, ncProgramFileName: program.fileName, ncProgramStorageKey: program.storageKey };
                      })()
                    : {}),
                })),
              },
            }
          : {}),
      },
      include: WO_INCLUDE,
    });
    if (recipe && this.tooling) {
      for (const step of recipe.steps) {
        const operation = created.operations.find((item) => item.seq === step.seq);
        if (operation) await this.tooling.copyRecipeRequirements(tx, tenantId, step.id, operation.id);
      }
    }
    return created;
  }

  async findOperations(tenantId: string, workOrderId: string) {
    await this.findOne(tenantId, workOrderId);
    return this.prisma.workOrderOperation.findMany({
      where: { tenantId, workOrderId },
      include: { machine: { select: { id: true, name: true } }, ncProgram: { select: { id: true, version: true, status: true, fileName: true, checksum: true, effectivityScope: true } } },
      orderBy: { seq: "asc" },
    });
  }

  async updateOperation(
    tenantId: string,
    workOrderId: string,
    operationId: string,
    dto: UpdateWorkOrderOperationDto,
  ) {
    const operation = await this.findOperation(tenantId, workOrderId, operationId);
    if (operation.startedAt && (dto.machineId !== undefined || dto.ncProgramId !== undefined || dto.status !== undefined)) {
      throw new ConflictException("Başlatılmış operasyonda tezgah veya durum değiştirilemez");
    }
    if (dto.status === "IN_PROGRESS" || dto.status === "COMPLETED") {
      throw new ConflictException("Operasyonu üretim koşusuyla başlatın ve ayrı tamamla işlemiyle kapatın");
    }
    if (dto.machineId) await this.ensureMachine(tenantId, dto.machineId);
    let ncSnapshot: Record<string, unknown> = {};
    if (dto.ncProgramId) {
      const workOrder = await this.prisma.workOrder.findFirst({ where: { id: workOrderId, tenantId } });
      if (!workOrder) throw new NotFoundException("İş emri bulunamadı");
      const program = await this.ncPrograms().assertNcProgramUsable(tenantId, dto.ncProgramId, workOrder.partId, dto.machineId ?? operation.machineId);
      ncSnapshot = { ncProgramId: program.id, ncProgramVersion: program.version, ncProgramChecksum: program.checksum, ncProgramFileName: program.fileName, ncProgramStorageKey: program.storageKey };
    }
    const updated = await this.prisma.workOrderOperation.updateMany({
      where: { id: operation.id, tenantId, workOrderId },
      data: { ...dto, ...ncSnapshot },
    });
    if (updated.count === 0) throw new NotFoundException("İş emri operasyonu bulunamadı");
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id: workOrderId });
    return this.prisma.workOrderOperation.findFirstOrThrow({
      where: { id: operation.id, tenantId, workOrderId },
      include: { machine: { select: { id: true, name: true } }, ncProgram: { select: { id: true, version: true, status: true, fileName: true, checksum: true, effectivityScope: true } } },
    });
  }

  async completeOperation(
    tenantId: string,
    workOrderId: string,
    operationId: string,
    dto: CompleteWorkOrderOperationDto,
    userId?: string,
  ) {
    const operation = await this.findOperation(tenantId, workOrderId, operationId);
    // Completion messages from HMI/telemetry are at-least-once. A repeated
    // completion returns the immutable completed operation and never calls the
    // tooling life-consumption boundary a second time.
    if (operation.status === "COMPLETED") {
      return this.prisma.workOrderOperation.findFirstOrThrow({
        where: { id: operation.id, tenantId, workOrderId },
        include: { machine: { select: { id: true, name: true } } },
      });
    }
    if (operation.status !== "IN_PROGRESS") {
      throw new ConflictException("Yalnızca devam eden operasyon tamamlanabilir");
    }
    const activeRun = await this.prisma.productionRun.findFirst({ where: { tenantId, operationId, endedAt: null } });
    if (activeRun) throw new ConflictException("Aktif üretim koşusu varken operasyon tamamlanamaz");
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workOrderOperation.updateMany({
        where: { id: operation.id, tenantId, workOrderId, status: "IN_PROGRESS" },
        data: { status: "COMPLETED", completedAt: new Date(), ...(dto.notes !== undefined ? { notes: dto.notes } : {}) },
      });
      if (!updated.count) throw new ConflictException("Operasyon durumu eşzamanlı değişti; tekrar deneyin");
      if (this.tooling) await this.tooling.completeOperation(tx, tenantId, userId, operation.id);
    });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id: workOrderId });
    return this.prisma.workOrderOperation.findFirstOrThrow({
      where: { id: operation.id, tenantId, workOrderId },
      include: { machine: { select: { id: true, name: true } } },
    });
  }

  async remove(tenantId: string, id: string) {
    const wo = await this.findOne(tenantId, id);
    if (wo.status !== "PLANNED" && wo.status !== "CANCELLED") {
      throw new ConflictException("Sadece PLANNED veya CANCELLED iş emri silinebilir");
    }
    const deleted = await this.prisma.workOrder.deleteMany({ where: { id, tenantId } });
    if (deleted.count === 0) throw new NotFoundException("İş emri bulunamadı");
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id, deleted: true });
    return wo;
  }

  private async ensureMachine(tenantId: string, machineId: string, client: Pick<PrismaService, "machine"> = this.prisma) {
    const machine = await client.machine.findFirst({
      where: { id: machineId, tenantId, isActive: true },
    });
    if (!machine) throw new NotFoundException("Tezgah bulunamadı veya pasif");
  }

  private async findOperation(tenantId: string, workOrderId: string, operationId: string) {
    const operation = await this.prisma.workOrderOperation.findFirst({
      where: { id: operationId, tenantId, workOrderId },
    });
    if (!operation) throw new NotFoundException("İş emri operasyonu bulunamadı");
    return operation;
  }

  private ncPrograms() {
    if (!this.parts) throw new ConflictException("NC program policy service is unavailable");
    return this.parts;
  }
}
