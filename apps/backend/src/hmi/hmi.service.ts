import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateMaintenanceRequestDto, DeclareMaintenanceBreakdownDto, HmiCompleteOperationDto, HmiLifecycleCommandDto, HmiOperationQueueQueryDto, HmiProductionReportDto, HmiReworkReportDto, HmiReworkStartDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { ProductionService } from "../production/production.service";
import { ToolingService } from "../tooling/tooling.service";
import { WorkOrdersService } from "../work-orders/work-orders.service";
import { ProductionMaterialService } from "../production-material/production-material.service";
import { QualityExecutionService } from "../quality-execution/quality-execution.service";
import { ControllerVerificationService } from "../controller-verification/controller-verification.service";
import { MachineMaintenanceAvailabilityService, type MachineMaintenanceAvailability } from "../machines/machine-maintenance-availability.service";
import { MaintenanceOrdersService } from "../maintenance-orders/maintenance-orders.service";

const operationInclude = {
  workOrder: {
    select: {
      id: true, woNo: true, quantity: true, priority: true, status: true, dueDate: true, plannedStartDate: true, plannedEndDate: true,
      machine: { select: { id: true, name: true, unit: { select: { id: true, name: true } } } },
      part: { select: { id: true, partNo: true, revision: true, name: true } },
    },
  },
  machine: { select: { id: true, name: true, unit: { select: { id: true, name: true } } } },
  ncProgram: { select: { id: true, version: true, status: true, fileName: true, checksum: true, effectivityScope: true } },
  toolRequirements: { where: { isRequired: true }, select: { id: true } },
  fixtureRequirements: { where: { isRequired: true }, select: { id: true } },
  setupVerifications: { orderBy: { createdAt: "desc" as const }, take: 1, select: { status: true, verifiedAt: true, invalidatedReason: true } },
} as const;

@Injectable()
export class HmiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly production: ProductionService,
    private readonly workOrders: WorkOrdersService,
    private readonly tooling: ToolingService,
    private readonly materials: ProductionMaterialService,
    private readonly quality: QualityExecutionService,
    private readonly controllerVerification: ControllerVerificationService,
    private readonly maintenanceAvailability: MachineMaintenanceAvailabilityService,
    private readonly maintenance: MaintenanceOrdersService,
  ) {}

  async list(tenantId: string, query: HmiOperationQueueQueryDto) {
    const operations = await this.prisma.workOrderOperation.findMany({
      where: {
        tenantId,
        status: query.status ? query.status : { in: ["PENDING", "SETUP", "IN_PROGRESS", "PAUSED", "HELD", "REWORK", "BLOCKED"] },
        ...(query.machineId ? { OR: [{ machineId: query.machineId }, { machineId: null, workOrder: { machineId: query.machineId } }] } : {}),
        workOrder: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
      },
      include: operationInclude,
      orderBy: [{ workOrder: { priority: "asc" } }, { workOrder: { dueDate: "asc" } }, { seq: "asc" }],
    });
    return operations.map((operation) => this.queueRow(operation));
  }

  async detail(tenantId: string, operationId: string) {
    const operation = await this.operation(tenantId, operationId);
    const machineId = operation.machineId ?? operation.workOrder.machine?.id;
    const [setup, activeRun, requirements, qualityStatus, executionHistory, reworkRequirements, controllerVerification, maintenanceAvailability] = await Promise.all([
      this.tooling.getSetup(tenantId, operationId),
      this.prisma.productionRun.findFirst({
        where: { tenantId, operationId, endedAt: null },
        select: { id: true, startedAt: true, goodCount: true, scrapCount: true, notes: true, machineId: true },
      }),
      this.materials.requirements(tenantId, operation.workOrderId),
      this.quality.operationStatus(tenantId, operation.workOrderId, operation.id),
      this.prisma.productionExecutionEvent.findMany({ where: { tenantId, operationId }, include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
      this.prisma.reworkRequirement.findMany({ where: { tenantId, reworkOperationId: operationId }, include: { nonConformance: { select: { id: true } } }, orderBy: { createdAt: "desc" } }),
      this.controllerVerification.status(tenantId, operation.machineId ?? operation.workOrder.machine?.id, operation.ncProgram?.fileName),
      machineId ? this.maintenanceAvailability.status(tenantId, machineId) : Promise.resolve(null),
    ]);
    const checklist = this.checklist(operation, setup, Boolean(activeRun), qualityStatus, controllerVerification, maintenanceAvailability);
    return { ...this.queueRow(operation), setup, activeRun, materialRequirements: requirements, qualityStatus, executionHistory, reworkRequirements, controllerVerification, maintenanceAvailability, checklist };
  }

  async start(tenantId: string, userId: string, operationId: string) {
    const operation = await this.operation(tenantId, operationId);
    const machineId = operation.machineId ?? operation.workOrder.machine?.id;
    const requirements = await this.materials.requirements(tenantId, operation.workOrderId);
    // Issued stock is no longer reserved at the warehouse, but still fulfils
    // the operation's material allocation.  Do not block a legitimate start
    // after a controlled issue.
    const shortage = requirements.find((item) => item.issueMethod === "MANUAL_ISSUE" && Number(item.reservedQty) + Number(item.issuedQty) < Number(item.requiredQty));
    if (shortage) throw new ConflictException("Required production material has not been fully allocated");
    await this.quality.assertNoActiveHold(tenantId, operation.workOrderId, operation.id);
    return this.production.start(tenantId, userId, operation.workOrderId, {
      operationId: operation.id,
      ...(machineId ? { machineId } : {}),
    });
  }

  async complete(tenantId: string, userId: string, operationId: string, dto: HmiCompleteOperationDto) {
    const operation = await this.operation(tenantId, operationId);
    if (operation.status !== "IN_PROGRESS") throw new ConflictException("Yalnızca devam eden operasyon tamamlanabilir");
    const activeRun = await this.prisma.productionRun.findFirst({ where: { tenantId, operationId, endedAt: null } });
    if (!activeRun) throw new ConflictException("Operasyon için aktif üretim koşusu bulunamadı. Miktar kaydı yalnız aktif koşu tamamlanırken yapılabilir.");
    await this.production.complete(tenantId, activeRun.id, {
      goodCount: dto.goodCount,
      scrapCount: dto.scrapCount,
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      completeWorkOrder: false,
    });
    return this.workOrders.completeOperation(tenantId, operation.workOrderId, operation.id, { notes: dto.notes }, userId);
  }

  setupStart(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) { return this.production.setupStart(tenantId, userId, operationId, dto); }
  async completeLifecycle(tenantId: string, userId: string, operationId: string, dto: HmiCompleteOperationDto) {
    // The original HMI completion form reports cumulative run totals.  Keep it
    // compatible, but route any final delta through the canonical, immutable
    // CNC-V1-04 production-report command before the terminal transition.
    const operation = await this.prisma.workOrderOperation.findFirst({
      where: { id: operationId, tenantId },
      select: { completedQty: true, scrapQty: true },
    });
    if (!operation) throw new NotFoundException("Work-order operation not found");

    const goodDelta = dto.goodCount - Number(operation.completedQty);
    const scrapDelta = dto.scrapCount - Number(operation.scrapQty);
    if (goodDelta < 0 || scrapDelta < 0) {
      throw new ConflictException("Completion quantities cannot be lower than quantities already reported");
    }
    if (goodDelta > 0 || scrapDelta > 0) {
      await this.production.report(tenantId, userId, operationId, {
        goodQty: goodDelta,
        scrapQty: scrapDelta,
        note: dto.notes,
        idempotencyKey: `hmi-final-report:${operationId}:${dto.goodCount}:${dto.scrapCount}`,
      });
    }
    return this.production.completeOperation(tenantId, userId, operationId, {
      notes: dto.notes,
      idempotencyKey: `hmi-complete:${operationId}`,
    });
  }
  setupComplete(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) { return this.production.setupComplete(tenantId, userId, operationId, dto); }
  pause(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) { return this.production.pause(tenantId, userId, operationId, dto); }
  resume(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) { return this.production.resume(tenantId, userId, operationId, dto); }
  hold(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) { return this.production.hold(tenantId, userId, operationId, dto); }
  releaseHold(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) { return this.production.releaseHold(tenantId, userId, operationId, dto); }
  report(tenantId: string, userId: string, operationId: string, dto: HmiProductionReportDto) { return this.production.report(tenantId, userId, operationId, dto); }
  startRework(tenantId: string, userId: string, operationId: string, dto: HmiReworkStartDto) { return this.production.startRework(tenantId, userId, operationId, dto.reworkRequirementId, dto); }
  reportRework(tenantId: string, userId: string, operationId: string, dto: HmiReworkReportDto) { return this.production.reportRework(tenantId, userId, operationId, dto.quantity, dto); }
  createMaintenanceRequest(tenantId: string, userId: string, dto: CreateMaintenanceRequestDto) { return this.maintenance.createRequest(tenantId, userId, dto); }
  declareMaintenanceBreakdown(tenantId: string, userId: string, dto: DeclareMaintenanceBreakdownDto) { return this.maintenance.declareBreakdown(tenantId, userId, dto); }

  private async operation(tenantId: string, operationId: string) {
    const operation = await this.prisma.workOrderOperation.findFirst({ where: { id: operationId, tenantId }, include: operationInclude });
    if (!operation) throw new NotFoundException("İş emri operasyonu bulunamadı");
    return operation;
  }

  private queueRow(operation: Awaited<ReturnType<HmiService["operation"]>>) {
    const verification = operation.setupVerifications[0] ?? null;
    const requiredSetup = operation.toolRequirements.length + operation.fixtureRequirements.length > 0;
    return {
      id: operation.id,
      workOrderId: operation.workOrderId,
      seq: operation.seq,
      name: operation.name,
      status: operation.status,
      completedQty: operation.completedQty,
      scrapQty: operation.scrapQty,
      startedAt: operation.startedAt,
      completedAt: operation.completedAt,
      instructionHtml: operation.instructionHtml,
      machine: operation.machine ?? operation.workOrder.machine,
      workCenter: operation.machine?.unit ?? operation.workOrder.machine?.unit ?? null,
      workOrder: operation.workOrder,
      ncProgram: operation.ncProgram,
      readiness: {
        requiredSetup,
        verificationStatus: verification?.status ?? (requiredSetup ? "NOT_VERIFIED" : "NOT_REQUIRED"),
        verificationAt: verification?.verifiedAt ?? null,
        invalidatedReason: verification?.invalidatedReason ?? null,
      },
    };
  }

  private checklist(operation: Awaited<ReturnType<HmiService["operation"]>>, setup: Awaited<ReturnType<ToolingService["getSetup"]>>, hasActiveRun: boolean, qualityStatus?: Awaited<ReturnType<QualityExecutionService["operationStatus"]>>, controller?: Awaited<ReturnType<ControllerVerificationService["status"]>>, maintenance?: MachineMaintenanceAvailability | null) {
    const items: Array<{ code: string; level: "PASS" | "BLOCKING" | "WARNING" | "INFORMATIONAL"; message: string }> = [];
    if (operation.ncProgramId) {
      items.push(operation.ncProgram?.status === "PUBLISHED"
        ? { code: "NC", level: "PASS", message: `Yayınlı NC revizyonu: ${operation.ncProgram.version} · ${operation.ncProgram.checksum.slice(0, 12)}…` }
        : { code: "NC", level: "BLOCKING", message: "Operasyonun NC programı yayınlı değil veya güncel değil." });
    } else {
      items.push({ code: "NC", level: "INFORMATIONAL", message: "Bu operasyon için NC programı atanmadı; canonical başlangıç politikası NC zorunluluğu uygulamaz." });
    }
    if (controller?.required) {
      items.push(controller.verification === "MATCH"
        ? { code: "CONTROLLER_NC", level: "PASS", message: `Controller program verified: ${controller.observedProgramIdentity}` }
        : { code: "CONTROLLER_NC", level: "BLOCKING", message: controller.reason ?? `Controller program verification is ${controller.verification}` });
    }
    if (maintenance && !maintenance.productionAllowed) {
      items.push({ code: "MAINTENANCE", level: "BLOCKING", message: maintenance.reasonCode === "MACHINE_OUT_OF_SERVICE" ? "Machine is explicitly out of service." : "Machine is unavailable due to maintenance." });
    } else if (maintenance?.maintenanceState === "MAINTENANCE_DUE") {
      items.push({ code: "MAINTENANCE", level: "WARNING", message: "Preventive maintenance is due; production remains permitted." });
    }
    const requiresSetup = setup.operation.toolRequirements.some((item) => item.isRequired) || setup.operation.fixtureRequirements.some((item) => item.isRequired);
    if (requiresSetup) {
      items.push(setup.verification?.status === "VERIFIED"
        ? { code: "SETUP", level: "PASS", message: "Zorunlu takım/fikstür setup'ı doğrulandı." }
        : { code: "SETUP", level: "BLOCKING", message: setup.verification?.invalidatedReason ?? "Zorunlu takım/fikstür setup doğrulaması bekleniyor." });
      if (setup.verification?.status === "VERIFIED") items.push({ code: "MACHINE_COMPATIBILITY", level: "PASS", message: "Seçilen fiziksel takım ve fikstürlerin makine uyumluluğu canonical setup doğrulamasında kabul edildi." });
    } else {
      items.push({ code: "SETUP", level: "INFORMATIONAL", message: "Bu operasyon için zorunlu tooling/fixture requirement yok." });
    }
    for (const fixture of setup.fixtureCompliance ?? []) {
      for (const message of fixture.evaluation.blockers) items.push({ code: "FIXTURE_POLICY", level: "BLOCKING", message });
      for (const message of fixture.evaluation.warnings) items.push({ code: "FIXTURE_POLICY", level: "WARNING", message });
    }
    if (!operation.machineId && !operation.workOrder.machine?.id) items.push({ code: "MACHINE", level: "WARNING", message: "Makine atanmadı; canonical başlangıç servisi mevcut iş emri politikasına göre yeniden değerlendirecek." });
    if (hasActiveRun) items.push({ code: "RUN", level: "INFORMATIONAL", message: "Bu operasyon için aktif üretim koşusu var." });
    if (qualityStatus?.required) {
      if (qualityStatus.activeHoldCount || qualityStatus.failed || qualityStatus.pendingReworkCount) items.push({ code: "QUALITY", level: "BLOCKING", message: "Quality hold, failure or rework is blocking this operation." });
      else if (qualityStatus.pending) items.push({ code: "QUALITY", level: "WARNING", message: "Required in-process inspection is pending; the server quality gate blocks completion." });
      else items.push({ code: "QUALITY", level: "PASS", message: "Required in-process quality gate is satisfied." });
    }
    return { items, blockers: items.filter((item) => item.level === "BLOCKING").map((item) => item.message), warnings: items.filter((item) => item.level === "WARNING").map((item) => item.message) };
  }
}
