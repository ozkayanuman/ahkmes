import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, WorkOrderStatus } from "@prisma/client";
import type {
  CompleteWorkOrderOperationDto,
  CreateWorkOrderDto,
  ScheduleWorkOrderDto,
  UpdateWorkOrderDto,
  UpdateWorkOrderOperationDto,
  ReleaseWorkOrderEngineeringDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { nextDocNo } from "../common/numbering";
import { PartsService } from "../parts/parts.service";
import { ToolingService } from "../tooling/tooling.service";
import { writeTransactionalAudit } from "../common/transactional-audit";
import { ProductionMaterialService } from "../production-material/production-material.service";
import { UomService } from "../uom/uom.service";
import { QualityExecutionService } from "../quality-execution/quality-execution.service";
import { OeeCalculationService } from "../oee/oee-calculation.service";
import type { OeeCalculationContext } from "../oee/oee-request";

const TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  PLANNED: ["RELEASED", "WAITING_MATERIAL", "IN_PRODUCTION", "CANCELLED"],
  RELEASED: ["WAITING_MATERIAL", "IN_PRODUCTION", "CANCELLED"],
  WAITING_MATERIAL: ["PLANNED", "RELEASED", "IN_PRODUCTION", "CANCELLED"],
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
    private readonly outbox: OutboxService,
    private readonly parts?: PartsService,
    private readonly tooling?: ToolingService,
    private readonly materials?: ProductionMaterialService,
    private readonly uom?: UomService,
    private readonly quality?: QualityExecutionService,
    private readonly canonicalOee?: OeeCalculationService,
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
  async oee(tenantId: string, workOrderId: string, context: OeeCalculationContext) {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, tenantId },
      select: { id: true },
    });
    if (!wo) throw new NotFoundException("İş emri bulunamadı");

    if (!this.canonicalOee) throw new ConflictException("Canonical OEE calculation service is unavailable");
    const canonical = await this.canonicalOee.calculate({ tenantId, workOrderId, ...context });

    return {
      workOrderId,
      goodCount: canonical.metrics.facts.goodCount,
      scrapCount: canonical.metrics.facts.scrapCount,
      quality: canonical.metrics.quality.value,
      performance: canonical.metrics.performance.value,
      availability: canonical.metrics.availability.value,
      oee: canonical.metrics.oee.value,
      asOf: context.asOf,
      dataQuality: canonical.metrics.dataQuality,
      issues: canonical.metrics.issues,
      canonical,
      note: canonical.metrics.issues.map((item) => item.message).join(" ") || undefined,
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

    const [consumptions, materialTransactions, productionRuns, finishedGoods] = await Promise.all([
      // Faz K: itemType/itemId polimorfik — Prisma tek bir "material" relation'ı
      // desteklemiyor, isim/kod çözümlemesi frontend'de (Lot'ta zaten kullanılan
      // desenle aynı) yapılır.
      this.prisma.materialConsumption.findMany({
        where: { tenantId, workOrderId },
        orderBy: { date: "asc" },
      }),
      this.prisma.productionMaterialTransaction.findMany({ where: { tenantId, requirement: { workOrderId } }, include: { requirement: { select: { itemType: true, itemId: true, unit: true } }, lot: { select: { id: true, lotNo: true } } }, orderBy: { createdAt: "asc" } }),
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
      backward: { materialsConsumed: consumptions, productionMaterialTransactions: materialTransactions },
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
    });
    // Faz K: itemType=PART (alt montaj) tüketimleri de mümkün ama Part'ta
    // standardCost alanı yok (Material'ın aksine) — bu satırlar için maliyet
    // hesaplanamaz, sahte kesinlik vermek yerine partial olarak işaretlenir
    // (mevcut "veri yoksa sessizce atlanmaz" felsefesiyle tutarlı).
    const materialIds = consumptions.filter((c) => c.itemType === "MATERIAL").map((c) => c.itemId);
    const materialsById = materialIds.length
      ? new Map(
          (
            await this.prisma.material.findMany({
              where: { id: { in: materialIds }, tenantId },
              select: { id: true, standardCost: true },
            })
          ).map((m) => [m.id, m.standardCost]),
        )
      : new Map<string, Prisma.Decimal | null>();
    let materialCost = 0;
    let materialCostPartial = false;
    for (const c of consumptions) {
      if (c.itemType !== "MATERIAL") {
        materialCostPartial = true;
        continue;
      }
      const standardCost = materialsById.get(c.itemId);
      if (standardCost == null) {
        materialCostPartial = true;
        continue;
      }
      materialCost += Number(c.quantity) * Number(standardCost);
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
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workOrder.updateMany({
        where: { id, tenantId },
        data: dto,
      });
      if (updated.count === 0) throw new NotFoundException("İş emri bulunamadı");
      await this.outbox.record(tx, tenantId, "workorder", id, "workorder.updated", { id });
    });
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
    const created = await this.prisma.$transaction(async (tx) => {
      const wo = await this.createInTransaction(tx, tenantId, dto);
      await this.outbox.record(tx, tenantId, "workorder", wo.id, "workorder.updated", { id: wo.id });
      return wo;
    });
    return created;
  }

  /** MRP gibi üst command'lerin WO ve karar kayıtlarını aynı transaction'a alması için. */
  async createInTransaction(tx: Prisma.TransactionClient, tenantId: string, dto: CreateWorkOrderDto) {
    const part = await tx.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    if (dto.machineId) await this.ensureMachine(tenantId, dto.machineId, tx);
    if (dto.plantId) {
      const plant = await tx.plant.findFirst({ where: { id: dto.plantId, tenantId } });
      if (!plant) throw new NotFoundException("Plant was not found");
    }
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

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workOrder.updateMany({
        where: { id, tenantId },
        data: dto,
      });
      if (updated.count === 0) throw new NotFoundException("İş emri bulunamadı");
      await this.outbox.record(tx, tenantId, "workorder", id, "workorder.updated", { id });
    });
    return this.findOne(tenantId, id);
  }

  async setStatus(tenantId: string, id: string, status: WorkOrderStatus) {
    const wo = await this.findOne(tenantId, id);
    if (!TRANSITIONS[wo.status].includes(status)) {
      throw new ConflictException(`Geçersiz durum geçişi: ${wo.status} → ${status}`);
    }
    if (status === "RELEASED") throw new ConflictException("Use the controlled engineering release command to release a work order");
    if (status === "IN_PRODUCTION" && wo.engineeringReleaseRequired && wo.status !== "RELEASED") throw new ConflictException("Work order requires a released engineering snapshot before production can start");
    if (status === "COMPLETED" && wo.operations.some((operation) => operation.status !== "COMPLETED" && operation.status !== "SKIPPED")) {
      throw new ConflictException("Rotalı iş emri, tüm operasyonları tamamlanmadan kapatılamaz");
    }
    if (status === "COMPLETED" && wo.engineeringReleaseRequired && this.materials) {
      const requirements = await this.materials.requirements(tenantId, id);
      const inconsistent = requirements.find((item) => item.issueMethod === "BACKFLUSH" && Number(item.consumedQty) < Number(item.requiredQty));
      if (inconsistent) throw new ConflictException("Backflush material accounting is incomplete; finish production consumption before closing the work order");
    }
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workOrder.updateMany({
        where: { id, tenantId, status: wo.status },
        data: { status },
      });
      if (updated.count === 0) throw new ConflictException("İş emri durumu eşzamanlı değişti; tekrar deneyin");
      await this.outbox.record(tx, tenantId, "workorder", id, "workorder.updated", { id, status });
    });
    return this.findOne(tenantId, id);
  }

  /** SalesOrder.release gibi başka application servislerinin aynı transaction
   * içinde çağırdığı tek iş emri + rota snapshot oluşturma sınırı. */
  async createWithRoute(
    tx: Prisma.TransactionClient,
    tenantId: string,
    data: Omit<Prisma.WorkOrderUncheckedCreateInput, "tenantId">,
  ) {
    return tx.workOrder.create({ data: { ...data, tenantId, engineeringReleaseRequired: true }, include: WO_INCLUDE });
  }

  async releaseEngineering(tenantId: string, userId: string, id: string, dto: ReleaseWorkOrderEngineeringDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "WorkOrder" WHERE "id" = ${id} FOR UPDATE`;
      const wo = await tx.workOrder.findFirst({ where: { id, tenantId }, include: { operations: true } });
      if (!wo) throw new NotFoundException("Work order was not found");
      if (wo.status !== "PLANNED" && wo.status !== "WAITING_MATERIAL") throw new ConflictException("Only an unstarted work order can receive an engineering release");
      if (wo.operations.length) throw new ConflictException("Work order already has an engineering snapshot");
      if (wo.plantId && wo.plantId !== dto.plantId) throw new ConflictException("Work order fulfillment plant cannot change during engineering release");
      const definition = await tx.productionDefinition.findFirst({ where: { id: dto.productionDefinitionId, tenantId, plantId: dto.plantId, partId: wo.partId, status: "RELEASED" }, include: { part: true, bomHeader: { include: { lines: true } }, recipeHeader: { include: { steps: { include: { toolRequirements: true, fixtureRequirements: true }, orderBy: { seq: "asc" } } } } } });
      if (!definition) throw new ConflictException("No matching released production definition was found for this plant and part revision");
      if (definition.part.engineeringStatus !== "RELEASED" || definition.bomHeader.status !== "RELEASED" || definition.recipeHeader.status !== "RELEASED") throw new ConflictException("Production definition engineering references are no longer released");
      if (!definition.recipeHeader.steps.length) throw new ConflictException("Released routing has no operations");
      if (wo.machineId) await this.ensureMachine(tenantId, wo.machineId, tx);
      const ncSnapshots = new Map<string, Awaited<ReturnType<PartsService["assertNcProgramUsable"]>>>();
      for (const step of definition.recipeHeader.steps) if (step.ncProgramId) ncSnapshots.set(step.ncProgramId, await this.ncPrograms().assertNcProgramUsable(tenantId, step.ncProgramId, wo.partId, wo.machineId ?? undefined, undefined, tx));
      const now = new Date();
      const snapshotLines = definition.bomHeader.lines.map((line) => ({ itemType: line.itemType, itemId: line.itemId, qtyPer: line.qtyPer.toString(), unit: line.unit, scrapPct: line.scrapPct?.toString(), issueMethod: line.issueMethod, consumeOnScrap: line.consumeOnScrap }));
      if (!this.uom) throw new ConflictException("Canonical UOM service is unavailable");
      await this.uom.ensureSystemUnits(tenantId, tx);
      const [componentMaterials, componentParts] = await Promise.all([
        tx.material.findMany({ where: { tenantId, id: { in: snapshotLines.filter((line) => line.itemType === "MATERIAL").map((line) => line.itemId) } }, select: { id: true, unit: true } }),
        tx.part.findMany({ where: { tenantId, id: { in: snapshotLines.filter((line) => line.itemType === "PART").map((line) => line.itemId) } }, select: { id: true, unit: true } }),
      ]);
      const componentUnits = new Map([...componentMaterials, ...componentParts].map((item) => [item.id, item.unit]));
      const materialRequirements = await Promise.all(snapshotLines.map(async (line) => {
        const canonicalUnit = componentUnits.get(line.itemId);
        if (!canonicalUnit) throw new ConflictException("Released BOM component could not be resolved");
        const conversion = await this.uom!.assertCompatible(tenantId, line.unit ?? canonicalUnit, canonicalUnit, tx);
        const sourceQty = new Prisma.Decimal(line.qtyPer).mul(wo.quantity).mul(new Prisma.Decimal(1).plus(new Prisma.Decimal(line.scrapPct ?? "0").div(100)));
        const requiredQty = sourceQty.mul(conversion.from.factorToBase).div(conversion.to.factorToBase).toDecimalPlaces(conversion.to.decimalPlaces, Prisma.Decimal.ROUND_HALF_UP);
        return { tenantId, itemType: line.itemType, itemId: line.itemId, unit: canonicalUnit, requiredQty, issueMethod: line.issueMethod, consumeOnScrap: line.consumeOnScrap, snapshotLine: { ...line, sourceUnit: line.unit ?? canonicalUnit, canonicalUnit } };
      }));
      const qualityPlans = await tx.qualityPlan.findMany({ where: { tenantId, partId: wo.partId, status: "RELEASED" }, include: { checks: { orderBy: { seq: "asc" } } } });
      const qualityRequirements = qualityPlans.flatMap((plan) => {
        const operationSequences = [...new Set(plan.checks.map((check) => check.operationSeq).filter((seq): seq is number => seq !== null))];
        const points = operationSequences.length ? operationSequences.map((seq) => ({ operationSeq: seq, inspectionPoint: "IN_PROCESS" as const })) : [{ operationSeq: undefined, inspectionPoint: "FINAL" as const }];
        return points.map(({ operationSeq, inspectionPoint }) => ({ tenantId, qualityPlanId: plan.id, planRevision: plan.revision, inspectionPoint, samplingMethod: plan.samplingMethod, sampleCount: plan.sampleCount, snapshot: { planId: plan.id, revision: plan.revision, inspectionPoint, operationSeq, samplingMethod: plan.samplingMethod, sampleCount: plan.sampleCount, checks: plan.checks.filter((check) => operationSeq === undefined ? check.operationSeq === null : check.operationSeq === operationSeq).map((check) => ({ seq: check.seq, checkpointName: check.checkpointName, unit: check.unit, lowerLimit: check.lowerLimit?.toString(), upperLimit: check.upperLimit?.toString(), characteristicType: check.characteristicType, qualitativeExpected: check.qualitativeExpected, isRequired: check.isRequired })) } }));
      });
      const updated = await tx.workOrder.update({ where: { id }, data: { plantId: dto.plantId, productionDefinitionId: definition.id, recipeHeaderId: definition.recipeHeader.id, recipeRevision: definition.recipeHeader.revision, routeSnapshotAt: now, engineeringReleasedAt: now, engineeringReleaseRequired: true, status: "RELEASED", engineeringSnapshot: { part: { id: definition.part.id, partNo: definition.part.partNo, revision: definition.part.revision, unit: definition.part.unit, drawingFileRef: definition.part.drawingFileRef, stepFileRef: definition.part.stepFileRef }, bom: { id: definition.bomHeader.id, revision: definition.bomHeader.revision, lines: snapshotLines }, routing: { id: definition.recipeHeader.id, revision: definition.recipeHeader.revision, operations: definition.recipeHeader.steps.map((step) => ({ seq: step.seq, name: step.name, standardMinutes: step.standardMinutes?.toString() ?? null, idealCycleTimeSec: step.idealCycleTimeSec?.toString() ?? null, ncProgramId: step.ncProgramId, toolRequirements: step.toolRequirements, fixtureRequirements: step.fixtureRequirements })) }, quality: qualityRequirements.map((item) => item.snapshot) }, materialRequirements: { create: materialRequirements }, operations: { create: definition.recipeHeader.steps.map((step) => { const nc = step.ncProgramId ? ncSnapshots.get(step.ncProgramId)! : null; return { tenantId, seq: step.seq, name: step.name, parameterName: step.parameterName, parameterValue: step.parameterValue, unit: step.unit, standardMinutes: step.standardMinutes, idealCycleTimeSec: step.idealCycleTimeSec, instructionHtml: step.instructionHtml, machineId: wo.machineId ?? undefined, ...(nc ? { ncProgramId: nc.id, ncProgramVersion: nc.version, ncProgramChecksum: nc.checksum, ncProgramFileName: nc.fileName, ncProgramStorageKey: nc.storageKey } : {}) }; }) } }, include: WO_INCLUDE });
      for (const quality of qualityRequirements) {
        const operationId = quality.snapshot.operationSeq ? updated.operations.find((operation) => operation.seq === quality.snapshot.operationSeq)?.id : undefined;
        await tx.productionQualityRequirement.create({ data: { ...quality, workOrderId: wo.id, operationId } });
      }
      if (this.tooling) for (const step of definition.recipeHeader.steps) { const operation = updated.operations.find((item) => item.seq === step.seq); if (operation) await this.tooling.copyRecipeRequirements(tx, tenantId, step.id, operation.id); }
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "work-order-engineering-release", entityId: id, action: "STATUS_CHANGE", before: { status: wo.status }, after: { status: "RELEASED", productionDefinitionId: definition.id, bomRevision: definition.bomHeader.revision, routingRevision: definition.recipeHeader.revision } });
      await this.outbox.record(tx, tenantId, "workorder", id, "workorder.updated", { id, status: "RELEASED" });
      return updated;
    });
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
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workOrderOperation.updateMany({
        where: { id: operation.id, tenantId, workOrderId },
        data: { ...dto, ...ncSnapshot },
      });
      if (updated.count === 0) throw new NotFoundException("İş emri operasyonu bulunamadı");
      await this.outbox.record(tx, tenantId, "workorder", workOrderId, "workorder.updated", { id: workOrderId });
    });
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
    if (this.quality) await this.quality.assertOperationClear(tenantId, workOrderId, operationId);
    const activeRun = await this.prisma.productionRun.findFirst({ where: { tenantId, operationId, endedAt: null } });
    if (activeRun) throw new ConflictException("Aktif üretim koşusu varken operasyon tamamlanamaz");
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workOrderOperation.updateMany({
        where: { id: operation.id, tenantId, workOrderId, status: "IN_PROGRESS" },
        data: { status: "COMPLETED", completedAt: new Date(), ...(dto.notes !== undefined ? { notes: dto.notes } : {}) },
      });
      if (!updated.count) throw new ConflictException("Operasyon durumu eşzamanlı değişti; tekrar deneyin");
      if (this.tooling) await this.tooling.completeOperation(tx, tenantId, userId, operation.id);
      await this.outbox.record(tx, tenantId, "workorder", workOrderId, "workorder.updated", { id: workOrderId });
    });
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
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.workOrder.deleteMany({ where: { id, tenantId } });
      if (deleted.count === 0) throw new NotFoundException("İş emri bulunamadı");
      await this.outbox.record(tx, tenantId, "workorder", id, "workorder.updated", { id, deleted: true });
    });
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
