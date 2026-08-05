import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { HmiCompleteOperationDto, HmiOperationQueueQueryDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { ProductionService } from "../production/production.service";
import { ToolingService } from "../tooling/tooling.service";
import { WorkOrdersService } from "../work-orders/work-orders.service";

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
  ) {}

  async list(tenantId: string, query: HmiOperationQueueQueryDto) {
    const operations = await this.prisma.workOrderOperation.findMany({
      where: {
        tenantId,
        status: query.status ? query.status : { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
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
    const [setup, activeRun] = await Promise.all([
      this.tooling.getSetup(tenantId, operationId),
      this.prisma.productionRun.findFirst({
        where: { tenantId, operationId, endedAt: null },
        select: { id: true, startedAt: true, goodCount: true, scrapCount: true, notes: true, machineId: true },
      }),
    ]);
    const checklist = this.checklist(operation, setup, Boolean(activeRun));
    return { ...this.queueRow(operation), setup, activeRun, checklist };
  }

  async start(tenantId: string, userId: string, operationId: string) {
    const operation = await this.operation(tenantId, operationId);
    const machineId = operation.machineId ?? operation.workOrder.machine?.id;
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

  private checklist(operation: Awaited<ReturnType<HmiService["operation"]>>, setup: Awaited<ReturnType<ToolingService["getSetup"]>>, hasActiveRun: boolean) {
    const items: Array<{ code: string; level: "PASS" | "BLOCKING" | "WARNING" | "INFORMATIONAL"; message: string }> = [];
    if (operation.ncProgramId) {
      items.push(operation.ncProgram?.status === "PUBLISHED"
        ? { code: "NC", level: "PASS", message: `Yayınlı NC revizyonu: ${operation.ncProgram.version} · ${operation.ncProgram.checksum.slice(0, 12)}…` }
        : { code: "NC", level: "BLOCKING", message: "Operasyonun NC programı yayınlı değil veya güncel değil." });
    } else {
      items.push({ code: "NC", level: "INFORMATIONAL", message: "Bu operasyon için NC programı atanmadı; canonical başlangıç politikası NC zorunluluğu uygulamaz." });
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
    return { items, blockers: items.filter((item) => item.level === "BLOCKING").map((item) => item.message), warnings: items.filter((item) => item.level === "WARNING").map((item) => item.message) };
  }
}
