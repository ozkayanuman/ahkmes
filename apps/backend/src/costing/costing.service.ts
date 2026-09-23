import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateCostRateCardDto, UpdateCostRateCardDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { writeTransactionalAudit } from "../common/transactional-audit";

type RateLine = { kind: string; targetId: string; rate: unknown };
type SelectedRateCard = { id: string; revision: number; currency: string; lines: RateLine[] };
type Issue = { code: string; message: string; component?: "MATERIAL" | "MACHINE" | "LABOR"; targetId?: string; operationId?: string };
type Tx = Prisma.TransactionClient;

const number = (value: unknown) => value == null ? 0 : Number(value);
const amount = (value: number) => new Prisma.Decimal(value.toFixed(6));
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class CostingService {
  constructor(private readonly prisma: PrismaService) {}

  async listRateCards(tenantId: string, plantId?: string) {
    return this.prisma.costRateCard.findMany({
      where: { tenantId, ...(plantId ? { plantId } : {}) },
      include: { plant: { select: { id: true, name: true, code: true } }, lines: { orderBy: [{ kind: "asc" }, { targetId: "asc" }] } },
      orderBy: [{ plantId: "asc" }, { revision: "desc" }],
    });
  }

  async createRateCard(tenantId: string, userId: string, dto: CreateCostRateCardDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertPlant(tx, tenantId, dto.plantId);
      await this.assertLineTargets(tx, tenantId, dto.lines);
      const latest = await tx.costRateCard.aggregate({ where: { tenantId, plantId: dto.plantId }, _max: { revision: true } });
      const created = await tx.costRateCard.create({
        data: {
          tenantId,
          plantId: dto.plantId,
          revision: (latest._max.revision ?? 0) + 1,
          currency: dto.currency,
          effectiveFrom: dto.effectiveFrom,
        },
      });
      await tx.costRateLine.createMany({ data: dto.lines.map((line) => ({ tenantId, rateCardId: created.id, kind: line.kind, targetId: line.targetId, rate: line.rate })) });
      const withLines = await tx.costRateCard.findUniqueOrThrow({ where: { id: created.id }, include: { lines: true } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "cost-rate-card", entityId: created.id, action: "CREATE", after: { plantId: created.plantId, revision: created.revision, currency: created.currency, effectiveFrom: created.effectiveFrom, lineCount: withLines.lines.length } });
      return withLines;
    });
  }

  async updateRateCard(tenantId: string, userId: string, id: string, dto: UpdateCostRateCardDto) {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.costRateCard.findFirst({ where: { id, tenantId }, include: { lines: true } });
      if (!card) throw new NotFoundException("Cost rate card was not found");
      if (card.status !== "DRAFT") throw new ConflictException("Released cost rate cards cannot be changed");
      if (dto.lines) await this.assertLineTargets(tx, tenantId, dto.lines);
      const updated = await tx.costRateCard.update({
        where: { id },
        data: {
          ...(dto.currency ? { currency: dto.currency } : {}),
          ...(dto.effectiveFrom ? { effectiveFrom: dto.effectiveFrom } : {}),
        },
      });
      if (dto.lines) {
        await tx.costRateLine.deleteMany({ where: { tenantId, rateCardId: id } });
        await tx.costRateLine.createMany({ data: dto.lines.map((line) => ({ tenantId, rateCardId: id, kind: line.kind, targetId: line.targetId, rate: line.rate })) });
      }
      const withLines = await tx.costRateCard.findUniqueOrThrow({ where: { id: updated.id }, include: { lines: true } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "cost-rate-card", entityId: id, action: "UPDATE", before: { currency: card.currency, effectiveFrom: card.effectiveFrom, lineCount: card.lines.length }, after: { currency: updated.currency, effectiveFrom: updated.effectiveFrom, lineCount: withLines.lines.length } });
      return withLines;
    });
  }

  async releaseRateCard(tenantId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CostRateCard" WHERE "id" = ${id} FOR UPDATE`;
      const card = await tx.costRateCard.findFirst({ where: { id, tenantId }, include: { lines: true } });
      if (!card) throw new NotFoundException("Cost rate card was not found");
      if (card.status !== "DRAFT") throw new ConflictException("Only a draft cost rate card can be released");
      await this.assertLineTargets(tx, tenantId, card.lines);
      const conflicting = await tx.costRateCard.findFirst({ where: { tenantId, plantId: card.plantId, effectiveFrom: card.effectiveFrom, status: "RELEASED" } });
      if (conflicting) throw new ConflictException("A released cost rate card already exists for this plant and effective date");
      const released = await tx.costRateCard.update({ where: { id }, data: { status: "RELEASED", releasedAt: new Date(), releasedById: userId } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "cost-rate-card", entityId: id, action: "STATUS_CHANGE", before: { status: card.status }, after: { status: "RELEASED", revision: card.revision, effectiveFrom: card.effectiveFrom } });
      return released;
    });
  }

  /** Called inside the engineering-release transaction after immutable BOM and routing snapshots exist. */
  async captureBaseline(tx: Tx, tenantId: string, userId: string, input: { workOrderId: string; plantId: string | null; materialRequirements: Array<{ itemType: string; itemId: string; requiredQty: Prisma.Decimal | string | number; unit: string; snapshotLine: unknown }>; operations: Array<{ id: string; seq: number; name: string; machineId: string | null; standardMinutes: Prisma.Decimal | string | number | null }>; capturedAt: Date }) {
    const issues: Issue[] = [];
    let card: SelectedRateCard | null = null;
    if (!input.plantId) {
      issues.push({ code: "MISSING_PLANT", message: "Work order has no plant provenance; no released rate card can be selected." });
    } else {
      card = await tx.costRateCard.findFirst({
        where: { tenantId, plantId: input.plantId, status: "RELEASED", effectiveFrom: { lte: input.capturedAt } },
        include: { lines: true }, orderBy: { effectiveFrom: "desc" },
      }) as unknown as SelectedRateCard | null;
      if (!card) issues.push({ code: "MISSING_RELEASED_RATE_CARD", message: "No released cost rate card is effective for this plant and release date." });
    }
    const rates = new Map<string, number>((card?.lines ?? []).map((line) => [`${line.kind}:${line.targetId}`, number(line.rate)]));
    const lines: Array<{ tenantId: string; kind: "MATERIAL" | "MACHINE" | "LABOR"; targetId?: string; operationId?: string; quantity?: Prisma.Decimal; minutes?: Prisma.Decimal; rate?: Prisma.Decimal; amount?: Prisma.Decimal; issueCode?: string; provenance: Prisma.InputJsonValue }> = [];
    let material = 0; let machine = 0; let labor = 0;
    let materialPartial = false; let machinePartial = false; let laborPartial = false;

    for (const requirement of input.materialRequirements) {
      if (requirement.itemType !== "MATERIAL") {
        materialPartial = true;
        issues.push({ code: "UNPRICED_PART_REQUIREMENT", message: "A part/subassembly requirement has no V1 material rate.", component: "MATERIAL", targetId: requirement.itemId });
        lines.push({ tenantId, kind: "MATERIAL", targetId: requirement.itemId, quantity: new Prisma.Decimal(requirement.requiredQty), issueCode: "UNPRICED_PART_REQUIREMENT", provenance: json({ source: "ProductionMaterialRequirement", snapshotLine: requirement.snapshotLine }) });
        continue;
      }
      const rate = rates.get(`MATERIAL:${requirement.itemId}`);
      if (rate === undefined) {
        materialPartial = true;
        issues.push({ code: "MISSING_MATERIAL_RATE", message: "Released rate card has no material rate for a planned requirement.", component: "MATERIAL", targetId: requirement.itemId });
        lines.push({ tenantId, kind: "MATERIAL", targetId: requirement.itemId, quantity: new Prisma.Decimal(requirement.requiredQty), issueCode: "MISSING_MATERIAL_RATE", provenance: json({ source: "ProductionMaterialRequirement", snapshotLine: requirement.snapshotLine }) });
        continue;
      }
      const value = number(requirement.requiredQty) * rate;
      material += value;
      lines.push({ tenantId, kind: "MATERIAL", targetId: requirement.itemId, quantity: new Prisma.Decimal(requirement.requiredQty), rate: amount(rate), amount: amount(value), provenance: json({ source: "ProductionMaterialRequirement", snapshotLine: requirement.snapshotLine }) });
    }
    const laborRate = rates.get("LABOR:DEFAULT");
    for (const operation of input.operations) {
      if (operation.standardMinutes == null) {
        machinePartial = true; laborPartial = true;
        issues.push({ code: "MISSING_STANDARD_MINUTES", message: "An operation has no immutable standard minutes.", operationId: operation.id });
        continue;
      }
      const minutes = number(operation.standardMinutes);
      if (!operation.machineId) {
        machinePartial = true;
        issues.push({ code: "MISSING_OPERATION_MACHINE", message: "An operation has no assigned machine in the engineering snapshot.", component: "MACHINE", operationId: operation.id });
        lines.push({ tenantId, kind: "MACHINE", operationId: operation.id, minutes: amount(minutes), issueCode: "MISSING_OPERATION_MACHINE", provenance: { source: "WorkOrderOperation", seq: operation.seq, name: operation.name } });
      } else {
        const rate = rates.get(`MACHINE:${operation.machineId}`);
        if (rate === undefined) {
          machinePartial = true;
          issues.push({ code: "MISSING_MACHINE_RATE", message: "Released rate card has no machine rate for an operation.", component: "MACHINE", targetId: operation.machineId, operationId: operation.id });
          lines.push({ tenantId, kind: "MACHINE", targetId: operation.machineId, operationId: operation.id, minutes: amount(minutes), issueCode: "MISSING_MACHINE_RATE", provenance: { source: "WorkOrderOperation", seq: operation.seq, name: operation.name } });
        } else {
          const value = minutes / 60 * rate; machine += value;
          lines.push({ tenantId, kind: "MACHINE", targetId: operation.machineId, operationId: operation.id, minutes: amount(minutes), rate: amount(rate), amount: amount(value), provenance: { source: "WorkOrderOperation", seq: operation.seq, name: operation.name } });
        }
      }
      if (laborRate === undefined) {
        laborPartial = true;
        issues.push({ code: "MISSING_LABOR_RATE", message: "Released rate card has no DEFAULT labor rate.", component: "LABOR", operationId: operation.id });
        lines.push({ tenantId, kind: "LABOR", targetId: "DEFAULT", operationId: operation.id, minutes: amount(minutes), issueCode: "MISSING_LABOR_RATE", provenance: { source: "WorkOrderOperation", seq: operation.seq, name: operation.name } });
      } else {
        const value = minutes / 60 * laborRate; labor += value;
        lines.push({ tenantId, kind: "LABOR", targetId: "DEFAULT", operationId: operation.id, minutes: amount(minutes), rate: amount(laborRate), amount: amount(value), provenance: { source: "WorkOrderOperation", seq: operation.seq, name: operation.name } });
      }
    }
    const isPartial = !card || materialPartial || machinePartial || laborPartial;
    const baseline = await tx.workOrderCostBaseline.create({
      data: { tenantId, workOrderId: input.workOrderId, rateCardId: card?.id, rateCardRevision: card?.revision, currency: card?.currency, capturedAt: input.capturedAt, capturedById: userId, plannedMaterialCost: materialPartial ? null : amount(material), plannedMachineCost: machinePartial ? null : amount(machine), plannedLaborCost: laborPartial ? null : amount(labor), plannedTotalCost: isPartial ? null : amount(material + machine + labor), dataQuality: isPartial ? "PARTIAL" : "COMPLETE", issues: issues as Prisma.InputJsonValue },
    });
    await tx.workOrderCostBaselineLine.createMany({ data: lines.map(({ tenantId: _lineTenant, ...line }) => ({ ...line, tenantId, baselineId: baseline.id })) });
    const withLines = await tx.workOrderCostBaseline.findUniqueOrThrow({ where: { id: baseline.id }, include: { lines: true } });
    await writeTransactionalAudit(tx, { tenantId, userId, entity: "work-order-cost-baseline", entityId: baseline.id, action: "CREATE", after: { workOrderId: input.workOrderId, rateCardId: card?.id ?? null, dataQuality: baseline.dataQuality, issueCount: issues.length } });
    return withLines;
  }

  async calculate(tenantId: string, workOrderId: string, asOf = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const workOrder = await tx.workOrder.findFirst({ where: { id: workOrderId, tenantId }, select: { id: true } });
      if (!workOrder) throw new NotFoundException("Work order was not found");
      const baseline = await tx.workOrderCostBaseline.findFirst({ where: { tenantId, workOrderId }, include: { lines: true, rateCard: { include: { lines: true } } } });
      if (!baseline) return this.missingBaseline(workOrderId, asOf);
      const [consumptions, runs, reports, rework] = await Promise.all([
        tx.materialConsumption.findMany({ where: { tenantId, workOrderId, type: "CONSUMED", date: { lte: asOf } }, orderBy: { date: "asc" } }),
        tx.productionRun.findMany({ where: { tenantId, workOrderId, startedAt: { lte: asOf } }, select: { id: true, operationId: true, machineId: true, startedAt: true, endedAt: true }, orderBy: { startedAt: "asc" } }),
        tx.productionReport.findMany({ where: { tenantId, workOrderId, createdAt: { lte: asOf } }, select: { goodQty: true, scrapQty: true, reworkQty: true } }),
        tx.reworkRequirement.findMany({ where: { tenantId, workOrderId, reworkRunId: { not: null } }, select: { reworkRunId: true } }),
      ]);
      const issues = [...((baseline.issues as Issue[] | null) ?? [])];
      const rateMap = new Map((baseline.rateCard?.lines ?? []).map((line) => [`${line.kind}:${line.targetId}`, number(line.rate)]));
      let material = 0; let machine = 0; let labor = 0;
      let materialPartial = false; let machinePartial = false; let laborPartial = false;
      const operationRows = new Map<string, { operationId: string | null; materialCost: number; machineCost: number; laborCost: number; reworkCost: number }>();
      const row = (operationId: string | null) => { const key = operationId ?? "UNASSIGNED"; const existing = operationRows.get(key); if (existing) return existing; const created = { operationId, materialCost: 0, machineCost: 0, laborCost: 0, reworkCost: 0 }; operationRows.set(key, created); return created; };
      for (const item of consumptions) {
        const rate = item.itemType === "MATERIAL" ? rateMap.get(`MATERIAL:${item.itemId}`) : undefined;
        if (rate === undefined) { materialPartial = true; issues.push({ code: item.itemType === "MATERIAL" ? "MISSING_ACTUAL_MATERIAL_RATE" : "UNPRICED_ACTUAL_PART", message: "An actual consumed item has no pinned material rate.", component: "MATERIAL", targetId: item.itemId }); continue; }
        const value = number(item.quantity) * rate; material += value; row(null).materialCost += value;
      }
      const reworkRunIds = new Set(rework.map((item) => item.reworkRunId).filter((id): id is string => Boolean(id)));
      for (const run of runs) {
        const end = run.endedAt && run.endedAt < asOf ? run.endedAt : asOf;
        const hours = Math.max(0, (end.getTime() - run.startedAt.getTime()) / 3_600_000);
        const operation = row(run.operationId);
        const machineRate = run.machineId ? rateMap.get(`MACHINE:${run.machineId}`) : undefined;
        if (machineRate === undefined) { machinePartial = true; issues.push({ code: "MISSING_ACTUAL_MACHINE_RATE", message: "An actual production run has no pinned machine rate.", component: "MACHINE", targetId: run.machineId ?? undefined, operationId: run.operationId ?? undefined }); } else { const value = hours * machineRate; machine += value; operation.machineCost += value; if (reworkRunIds.has(run.id)) operation.reworkCost += value; }
        const laborRate = rateMap.get("LABOR:DEFAULT");
        if (laborRate === undefined) { laborPartial = true; issues.push({ code: "MISSING_ACTUAL_LABOR_RATE", message: "Actual production time has no pinned DEFAULT labor rate.", component: "LABOR", operationId: run.operationId ?? undefined }); } else { const value = hours * laborRate; labor += value; operation.laborCost += value; if (reworkRunIds.has(run.id)) operation.reworkCost += value; }
      }
      const goodQty = reports.reduce((sum, report) => sum + number(report.goodQty), 0);
      const scrapQty = reports.reduce((sum, report) => sum + number(report.scrapQty), 0);
      const reworkQty = reports.reduce((sum, report) => sum + number(report.reworkQty), 0);
      const actualPartial = materialPartial || machinePartial || laborPartial;
      const actualKnownTotal = material + machine + labor;
      const planned = { material: baseline.plannedMaterialCost == null ? null : number(baseline.plannedMaterialCost), machine: baseline.plannedMachineCost == null ? null : number(baseline.plannedMachineCost), labor: baseline.plannedLaborCost == null ? null : number(baseline.plannedLaborCost), total: baseline.plannedTotalCost == null ? null : number(baseline.plannedTotalCost) };
      const actual = { material: materialPartial ? null : material, machine: machinePartial ? null : machine, labor: laborPartial ? null : labor, total: actualPartial ? null : actualKnownTotal };
      const varianceTotal = planned.total != null && actual.total != null ? actual.total - planned.total : null;
      return { workOrderId, currency: baseline.currency, asOf, dataQuality: baseline.dataQuality === "COMPLETE" && !actualPartial ? "COMPLETE" : "PARTIAL", issues, baseline: { id: baseline.id, rateCardId: baseline.rateCardId, rateCardRevision: baseline.rateCardRevision, capturedAt: baseline.capturedAt, dataQuality: baseline.dataQuality }, planned, actual, variance: { material: planned.material != null && actual.material != null ? actual.material - planned.material : null, machine: planned.machine != null && actual.machine != null ? actual.machine - planned.machine : null, labor: planned.labor != null && actual.labor != null ? actual.labor - planned.labor : null, total: varianceTotal, percentage: varianceTotal != null && planned.total ? varianceTotal / planned.total : null }, unitCost: goodQty > 0 && actual.total != null ? actual.total / goodQty : null, output: { goodQty, scrapQty, reworkQty }, operations: [...operationRows.values()], legacy: { materialCost: material, materialCostPartial: materialPartial, machineCost: machine, machineCostPartial: machinePartial, laborCost: labor, laborCostPartial: laborPartial, totalCost: actualKnownTotal }, note: issues.map((issue) => issue.message).join(" ") || undefined };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async workOrderSummaries(tenantId: string, plantId?: string, asOf = new Date()) {
    const orders = await this.prisma.workOrder.findMany({
      where: { tenantId, ...(plantId ? { plantId } : {}) },
      select: { id: true, woNo: true, status: true, plantId: true, part: { select: { partNo: true, name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return Promise.all(orders.map(async (order) => {
      const cost = await this.calculate(tenantId, order.id, asOf);
      return { ...order, cost: { currency: cost.currency, dataQuality: cost.dataQuality, planned: cost.planned.total, actual: cost.actual.total, variance: cost.variance.total, unitCost: cost.unitCost, issueCount: cost.issues.length } };
    }));
  }

  private missingBaseline(workOrderId: string, asOf: Date) {
    const issue: Issue = { code: "MISSING_RELEASED_COST_BASELINE", message: "This work order has no released V1 costing baseline." };
    return { workOrderId, currency: null, asOf, dataQuality: "PARTIAL", issues: [issue], baseline: null, planned: { material: null, machine: null, labor: null, total: null }, actual: { material: null, machine: null, labor: null, total: null }, variance: { material: null, machine: null, labor: null, total: null, percentage: null }, unitCost: null, output: { goodQty: 0, scrapQty: 0, reworkQty: 0 }, operations: [], legacy: { materialCost: 0, materialCostPartial: true, machineCost: 0, machineCostPartial: true, laborCost: 0, laborCostPartial: true, totalCost: 0 }, note: issue.message };
  }

  private async assertPlant(tx: Tx, tenantId: string, plantId: string) {
    const plant = await tx.plant.findFirst({ where: { id: plantId, tenantId }, select: { id: true } });
    if (!plant) throw new NotFoundException("Plant was not found");
  }

  private async assertLineTargets(tx: Tx, tenantId: string, lines: RateLine[]) {
    const materialIds = lines.filter((line) => line.kind === "MATERIAL").map((line) => line.targetId);
    const machineIds = lines.filter((line) => line.kind === "MACHINE").map((line) => line.targetId);
    const [materials, machines] = await Promise.all([
      materialIds.length ? tx.material.findMany({ where: { tenantId, id: { in: materialIds } }, select: { id: true } }) : [],
      machineIds.length ? tx.machine.findMany({ where: { tenantId, id: { in: machineIds } }, select: { id: true } }) : [],
    ]);
    if (new Set(materials.map((item) => item.id)).size !== new Set(materialIds).size) throw new NotFoundException("A cost rate card material target was not found in this tenant");
    if (new Set(machines.map((item) => item.id)).size !== new Set(machineIds).size) throw new NotFoundException("A cost rate card machine target was not found in this tenant");
    if (lines.some((line) => Number(line.rate) < 0)) throw new ConflictException("Cost rates cannot be negative");
  }
}
