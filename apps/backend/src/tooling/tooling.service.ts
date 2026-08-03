import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SetupVerificationStatus } from "@prisma/client";
import type {
  CreateFixtureDefinitionDto, CreatePhysicalFixtureDto, CreatePhysicalToolDto, CreateToolAssemblyDto,
  CreateToolComponentDto, CreateToolDefinitionDto, SetupAssignmentDto, UpdateToolDefinitionDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { PartsService } from "../parts/parts.service";
import { FixtureMaintenanceService } from "../fixture-maintenance/fixture-maintenance.service";

type Tx = Prisma.TransactionClient;
const TOOL_UNAVAILABLE = ["BROKEN", "QUARANTINED", "RETIRED", "EXPIRED"] as const;
const FIXTURE_UNAVAILABLE = ["MAINTENANCE", "QUARANTINED", "RETIRED"] as const;

@Injectable()
export class ToolingService {
  constructor(private readonly prisma: PrismaService, private readonly parts: PartsService, private readonly fixtureMaintenance: FixtureMaintenanceService) {}

  list(tenantId: string) {
    return Promise.all([
      this.prisma.toolDefinition.findMany({ where: { tenantId }, orderBy: [{ code: "asc" }, { revision: "desc" }], include: { assemblies: { include: { components: { include: { toolComponent: true } } } }, instances: true } }),
      this.prisma.toolComponent.findMany({ where: { tenantId }, orderBy: [{ code: "asc" }, { revision: "desc" }] }),
      this.prisma.fixtureDefinition.findMany({ where: { tenantId }, orderBy: [{ code: "asc" }, { revision: "desc" }], include: { instances: true } }),
      this.prisma.toolMachineCompatibility.findMany({ where: { tenantId }, include: { machine: { select: { id: true, name: true } }, toolDefinition: true, toolAssembly: true } }),
      this.prisma.fixtureMachineCompatibility.findMany({ where: { tenantId }, include: { machine: { select: { id: true, name: true } }, fixtureDefinition: true } }),
    ]).then(([toolDefinitions, toolComponents, fixtureDefinitions, toolCompatibility, fixtureCompatibility]) => ({ toolDefinitions, toolComponents, fixtureDefinitions, toolCompatibility, fixtureCompatibility }));
  }
  listFixtures(tenantId: string) {
    return this.prisma.fixtureDefinition.findMany({ where: { tenantId }, orderBy: [{ code: "asc" }, { revision: "desc" }], include: { instances: true } });
  }

  async createToolDefinition(tenantId: string, dto: CreateToolDefinitionDto) {
    return this.prisma.toolDefinition.create({ data: { tenantId, ...dto } });
  }
  async updateToolDefinition(tenantId: string, id: string, dto: UpdateToolDefinitionDto) {
    const result = await this.prisma.toolDefinition.updateMany({ where: { id, tenantId }, data: dto });
    if (!result.count) throw new NotFoundException("Takım tanımı bulunamadı");
    return this.prisma.toolDefinition.findFirstOrThrow({ where: { id, tenantId } });
  }
  async createToolComponent(tenantId: string, dto: CreateToolComponentDto) {
    return this.prisma.toolComponent.create({ data: { tenantId, ...dto } });
  }
  async createToolAssembly(tenantId: string, dto: CreateToolAssemblyDto) {
    const definition = await this.prisma.toolDefinition.findFirst({ where: { id: dto.toolDefinitionId, tenantId, isActive: true } });
    if (!definition) throw new NotFoundException("Takım tanımı bulunamadı");
    const components = await this.prisma.toolComponent.findMany({ where: { tenantId, id: { in: dto.componentIds }, isActive: true } });
    if (components.length !== dto.componentIds.length) throw new NotFoundException("Takım bileşeni bulunamadı");
    return this.prisma.toolAssembly.create({ data: { tenantId, toolDefinitionId: dto.toolDefinitionId, code: dto.code, name: dto.name, revision: dto.revision, isActive: dto.isActive, components: { create: dto.componentIds.map((toolComponentId, index) => ({ tenantId, toolComponentId, sequence: index + 1 })) }, }, include: { components: { include: { toolComponent: true } } } });
  }
  async createPhysicalTool(tenantId: string, dto: CreatePhysicalToolDto) {
    const definition = await this.prisma.toolDefinition.findFirst({ where: { id: dto.toolDefinitionId, tenantId, isActive: true } });
    if (!definition) throw new NotFoundException("Takım tanımı bulunamadı");
    if (dto.consumedLife + dto.remainingLife > Number(definition.maximumLife)) throw new ConflictException("Tüketilen ve kalan ömür maksimum ömrü aşamaz");
    if (dto.toolAssemblyId) {
      const assembly = await this.prisma.toolAssembly.findFirst({ where: { id: dto.toolAssemblyId, tenantId, toolDefinitionId: dto.toolDefinitionId, isActive: true } });
      if (!assembly) throw new NotFoundException("Takım assembly bulunamadı veya takım tanımıyla uyumsuz");
    }
    const status = dto.remainingLife <= 0 ? "EXPIRED" : dto.status;
    return this.prisma.physicalToolInstance.create({ data: { tenantId, ...dto, status } });
  }
  async createFixtureDefinition(tenantId: string, dto: CreateFixtureDefinitionDto) { return this.prisma.fixtureDefinition.create({ data: { tenantId, ...dto } }); }
  async createPhysicalFixture(tenantId: string, dto: CreatePhysicalFixtureDto) {
    const definition = await this.prisma.fixtureDefinition.findFirst({ where: { id: dto.fixtureDefinitionId, tenantId, isActive: true } });
    if (!definition) throw new NotFoundException("Fikstür tanımı bulunamadı");
    return this.prisma.physicalFixtureInstance.create({ data: { tenantId, ...dto } });
  }

  async addToolCompatibility(tenantId: string, dto: { machineId: string; toolDefinitionId?: string; toolAssemblyId?: string }) {
    await this.assertMachine(tenantId, dto.machineId);
    if (dto.toolDefinitionId) await this.assertToolDefinition(tenantId, dto.toolDefinitionId);
    if (dto.toolAssemblyId) await this.assertAssembly(tenantId, dto.toolAssemblyId);
    return this.prisma.toolMachineCompatibility.create({ data: { tenantId, ...dto } });
  }
  async addFixtureCompatibility(tenantId: string, dto: { machineId: string; fixtureDefinitionId: string }) {
    await this.assertMachine(tenantId, dto.machineId); await this.assertFixtureDefinition(tenantId, dto.fixtureDefinitionId);
    return this.prisma.fixtureMachineCompatibility.create({ data: { tenantId, ...dto } });
  }

  async createRecipeToolRequirement(tenantId: string, recipeStepId: string, dto: { toolDefinitionId?: string; toolAssemblyId?: string; isRequired: boolean; quantity: number; alternativeGroup?: string; sequence: number }) {
    await this.assertRecipeStep(tenantId, recipeStepId); await this.assertRequirementSubject(tenantId, dto);
    if (await this.prisma.operationToolRequirement.findFirst({ where: { tenantId, recipeStepId, toolDefinitionId: dto.toolDefinitionId ?? null, toolAssemblyId: dto.toolAssemblyId ?? null, alternativeGroup: dto.alternativeGroup ?? null } })) throw new ConflictException("Aynı takım requirement zaten tanımlı");
    return this.prisma.operationToolRequirement.create({ data: { tenantId, recipeStepId, ...dto } });
  }
  async createRecipeFixtureRequirement(tenantId: string, recipeStepId: string, dto: { fixtureDefinitionId: string; isRequired: boolean; quantity: number; alternativeGroup?: string; sequence: number }) {
    await this.assertRecipeStep(tenantId, recipeStepId); await this.assertFixtureDefinition(tenantId, dto.fixtureDefinitionId);
    if (await this.prisma.operationFixtureRequirement.findFirst({ where: { tenantId, recipeStepId, fixtureDefinitionId: dto.fixtureDefinitionId, alternativeGroup: dto.alternativeGroup ?? null } })) throw new ConflictException("Aynı fikstür requirement zaten tanımlı");
    return this.prisma.operationFixtureRequirement.create({ data: { tenantId, recipeStepId, ...dto } });
  }
  async createOperationToolRequirement(tenantId: string, operationId: string, dto: { toolDefinitionId?: string; toolAssemblyId?: string; isRequired: boolean; quantity: number; alternativeGroup?: string; sequence: number }) {
    const operation = await this.assertOperation(tenantId, operationId); if (operation.status !== "PENDING") throw new ConflictException("Başlatılmış/tamamlanmış operasyon requirement snapshot'ı değiştirilemez"); await this.assertRequirementSubject(tenantId, dto);
    if (await this.prisma.operationToolRequirement.findFirst({ where: { tenantId, workOrderOperationId: operationId, toolDefinitionId: dto.toolDefinitionId ?? null, toolAssemblyId: dto.toolAssemblyId ?? null, alternativeGroup: dto.alternativeGroup ?? null } })) throw new ConflictException("Aynı takım requirement zaten tanımlı");
    return this.prisma.operationToolRequirement.create({ data: { tenantId, workOrderOperationId: operationId, ...dto } });
  }
  async createOperationFixtureRequirement(tenantId: string, operationId: string, dto: { fixtureDefinitionId: string; isRequired: boolean; quantity: number; alternativeGroup?: string; sequence: number }) {
    const operation = await this.assertOperation(tenantId, operationId); if (operation.status !== "PENDING") throw new ConflictException("Başlatılmış/tamamlanmış operasyon requirement snapshot'ı değiştirilemez"); await this.assertFixtureDefinition(tenantId, dto.fixtureDefinitionId);
    if (await this.prisma.operationFixtureRequirement.findFirst({ where: { tenantId, workOrderOperationId: operationId, fixtureDefinitionId: dto.fixtureDefinitionId, alternativeGroup: dto.alternativeGroup ?? null } })) throw new ConflictException("Aynı fikstür requirement zaten tanımlı");
    return this.prisma.operationFixtureRequirement.create({ data: { tenantId, workOrderOperationId: operationId, ...dto } });
  }

  /** Replaces an unverified setup selection. A changed setup releases its old reservation and must be verified again. */
  async assignSetup(tenantId: string, operationId: string, dto: SetupAssignmentDto) {
    return this.prisma.$transaction((tx) => this.assignSetupInTransaction(tx, tenantId, operationId, dto));
  }
  private async assignSetupInTransaction(tx: Tx, tenantId: string, operationId: string, dto: SetupAssignmentDto) {
    const operation = await this.operationWithRequirements(tx, tenantId, operationId);
    if (operation.status === "IN_PROGRESS" || operation.status === "COMPLETED") throw new ConflictException("Başlatılmış veya tamamlanmış operasyonun setup'ı değiştirilemez");
    const machineId = operation.machineId;
    if (!machineId) throw new ConflictException("Setup doğrulaması için operasyona makine atanmalıdır");
    let verification = await tx.operationSetupVerification.findFirst({ where: { tenantId, workOrderOperationId: operationId }, orderBy: { createdAt: "desc" } });
    if (verification) {
      if (verification.status === "PENDING") {
        await tx.operationSetupAssignment.deleteMany({ where: { tenantId, verificationId: verification.id } });
      } else {
        await this.releaseVerification(tx, tenantId, verification.id, "Setup selection changed");
        verification = await tx.operationSetupVerification.create({ data: { tenantId, workOrderOperationId: operationId, machineId } });
      }
    } else verification = await tx.operationSetupVerification.create({ data: { tenantId, workOrderOperationId: operationId, machineId } });
    const toolReqIds = new Set(operation.toolRequirements.map((r) => r.id)); const fixtureReqIds = new Set(operation.fixtureRequirements.map((r) => r.id));
    for (const assignment of dto.toolAssignments) {
      if (!toolReqIds.has(assignment.requirementId)) throw new NotFoundException("Operasyon takım gereksinimi bulunamadı");
      const tool = await tx.physicalToolInstance.findFirst({ where: { id: assignment.physicalToolInstanceId, tenantId } }); if (!tool) throw new NotFoundException("Fiziksel takım bulunamadı");
      await tx.operationSetupAssignment.create({ data: { tenantId, verificationId: verification.id, toolRequirementId: assignment.requirementId, physicalToolInstanceId: assignment.physicalToolInstanceId, isActive: false } });
    }
    for (const assignment of dto.fixtureAssignments) {
      if (!fixtureReqIds.has(assignment.requirementId)) throw new NotFoundException("Operasyon fikstür gereksinimi bulunamadı");
      const fixture = await tx.physicalFixtureInstance.findFirst({ where: { id: assignment.physicalFixtureInstanceId, tenantId } }); if (!fixture) throw new NotFoundException("Fiziksel fikstür bulunamadı");
      await tx.operationSetupAssignment.create({ data: { tenantId, verificationId: verification.id, fixtureRequirementId: assignment.requirementId, physicalFixtureInstanceId: assignment.physicalFixtureInstanceId, isActive: false } });
    }
    return this.setupDetail(tx, tenantId, operationId);
  }

  async verifySetup(tenantId: string, userId: string, operationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "WorkOrderOperation" WHERE "id" = ${operationId} FOR UPDATE`;
      const operation = await this.operationWithRequirements(tx, tenantId, operationId);
      if (operation.status !== "PENDING") throw new ConflictException("Yalnızca bekleyen operasyon setup doğrulamasına uygundur");
      if (!operation.machineId) throw new ConflictException("Setup doğrulaması için operasyona makine atanmalıdır");
      const verification = await tx.operationSetupVerification.findFirst({ where: { tenantId, workOrderOperationId: operationId, machineId: operation.machineId }, orderBy: { createdAt: "desc" } });
      if (!verification) throw new ConflictException("Önce fiziksel takım ve fikstür ataması yapılmalıdır");
      const assignments = await tx.operationSetupAssignment.findMany({ where: { tenantId, verificationId: verification.id }, include: { physicalToolInstance: { include: { toolDefinition: true, toolAssembly: true } }, physicalFixtureInstance: { include: { fixtureDefinition: true } }, toolRequirement: true, fixtureRequirement: true } });
      if (!operation.ncProgramId) throw new ConflictException("CNC setup doğrulaması için PUBLISHED NC programı gerekli");
      await this.parts.assertNcProgramUsable(tenantId, operation.ncProgramId, operation.workOrder.partId, operation.machineId, operation.ncProgramChecksum ?? undefined, tx);
      this.assertRequirements(operation, assignments);
      const fixtureCompliance = new Map<string, any>();
      for (const a of assignments) {
        if (a.physicalToolInstance) await this.validateToolAssignment(tx, tenantId, operation.machineId, a);
        if (a.physicalFixtureInstance) {
          await this.validateFixtureAssignment(tx, tenantId, operation.machineId, a);
          const evaluation = await this.fixtureMaintenance.evaluate(tx, tenantId, a.physicalFixtureInstance.id);
          if (evaluation.blockers.length) throw new ConflictException(`Fikstür bakım/kalibrasyon doğrulaması başarısız: ${evaluation.blockers.join("; ")}`);
          fixtureCompliance.set(a.physicalFixtureInstance.id, evaluation);
        }
      }
      try {
        await tx.operationSetupAssignment.updateMany({ where: { tenantId, verificationId: verification.id }, data: { isActive: true } });
      } catch { throw new ConflictException("Fiziksel takım veya fikstür başka aktif bir operasyonda rezerve edildi"); }
      const toolIds = assignments.flatMap((a) => a.physicalToolInstanceId ? [a.physicalToolInstanceId] : []);
      const fixtureIds = assignments.flatMap((a) => a.physicalFixtureInstanceId ? [a.physicalFixtureInstanceId] : []);
      const reservedTools = toolIds.length ? await tx.physicalToolInstance.updateMany({ where: { tenantId, id: { in: toolIds }, status: "AVAILABLE" }, data: { status: "RESERVED" } }) : { count: 0 };
      const reservedFixtures = fixtureIds.length ? await tx.physicalFixtureInstance.updateMany({ where: { tenantId, id: { in: fixtureIds }, status: "AVAILABLE" }, data: { status: "RESERVED" } }) : { count: 0 };
      if (reservedTools.count !== toolIds.length || reservedFixtures.count !== fixtureIds.length) throw new ConflictException("Setup kaynağının durumu değişti; yeniden atama gerekli");
      const payload = this.snapshotPayload(tenantId, operation, assignments, userId, fixtureCompliance);
      await tx.operationSetupSnapshot.upsert({ where: { verificationId: verification.id }, create: { tenantId, verificationId: verification.id, payload }, update: {} });
      await tx.operationSetupVerification.update({ where: { id: verification.id }, data: { status: "VERIFIED", verifiedById: userId, verifiedAt: new Date(), invalidatedAt: null, invalidatedReason: null, version: { increment: 1 } } });
      await this.audit(tx, tenantId, userId, "OperationSetupVerification", verification.id, "CREATE", null, { status: "VERIFIED", operationId, machineId: operation.machineId });
      return this.setupDetail(tx, tenantId, operationId);
    });
  }

  async invalidateSetup(tenantId: string, userId: string, operationId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const verification = await tx.operationSetupVerification.findFirst({ where: { tenantId, workOrderOperationId: operationId }, orderBy: { createdAt: "desc" } });
      if (!verification) throw new NotFoundException("Setup bulunamadı");
      const operation = await this.assertOperation(tenantId, operationId, tx);
      if (operation.status === "IN_PROGRESS" || operation.status === "COMPLETED") throw new ConflictException("Başlatılmış/tamamlanmış operasyonun as-built setup kaydı değiştirilemez");
      await this.releaseVerification(tx, tenantId, verification.id, reason);
      await this.audit(tx, tenantId, userId, "OperationSetupVerification", verification.id, "STATUS_CHANGE", { status: verification.status }, { status: "INVALIDATED", reason });
      return this.setupDetail(tx, tenantId, operationId);
    });
  }

  async getSetup(tenantId: string, operationId: string) {
    const operation = await this.operationWithRequirements(this.prisma, tenantId, operationId);
    const verification = await this.setupDetail(this.prisma, tenantId, operationId);
    const fixtureCompliance = verification ? await Promise.all(verification.assignments.filter((a: any) => a.physicalFixtureInstanceId).map(async (a: any) => ({ fixtureId: a.physicalFixtureInstanceId, evaluation: await this.fixtureMaintenance.evaluateForTenant(tenantId, a.physicalFixtureInstanceId) }))) : [];
    return { operation, verification, fixtureCompliance };
  }
  async lifeHistory(tenantId: string, toolId: string) { await this.assertPhysicalTool(tenantId, toolId); return this.prisma.toolLifeEvent.findMany({ where: { tenantId, physicalToolInstanceId: toolId }, orderBy: { createdAt: "desc" } }); }

  async adjustLife(tenantId: string, userId: string, toolId: string, input: { consumedLife: number; version: number; reason: string }) {
    return this.prisma.$transaction(async (tx) => {
      const tool = await tx.physicalToolInstance.findFirst({ where: { id: toolId, tenantId }, include: { toolDefinition: true } });
      if (!tool) throw new NotFoundException("Fiziksel takım bulunamadı");
      if (tool.version !== input.version) throw new ConflictException("Takım ömrü başka bir işlemde değişti; güncel sürümü kullanın");
      if (input.consumedLife > Number(tool.toolDefinition.maximumLife)) throw new ConflictException("Tüketilen ömür maksimum ömrü aşamaz");
      const remainingLife = Number(tool.toolDefinition.maximumLife) - input.consumedLife;
      const status = remainingLife <= 0 ? "EXPIRED" : tool.status === "EXPIRED" ? "AVAILABLE" : tool.status;
      const result = await tx.physicalToolInstance.updateMany({ where: { id: toolId, tenantId, version: input.version }, data: { consumedLife: input.consumedLife, remainingLife, status, version: { increment: 1 } } });
      if (!result.count) throw new ConflictException("Takım ömrü başka bir işlemde değişti; tekrar deneyin");
      await tx.toolLifeEvent.create({ data: { tenantId, physicalToolInstanceId: toolId, eventType: "MANUAL_ADJUSTMENT", quantity: Math.abs(input.consumedLife - Number(tool.consumedLife)), idempotencyKey: `manual:${toolId}:${input.version}`, reason: input.reason, before: { consumedLife: Number(tool.consumedLife), remainingLife: Number(tool.remainingLife), version: tool.version }, after: { consumedLife: input.consumedLife, remainingLife, version: tool.version + 1 }, createdById: userId } });
      await this.audit(tx, tenantId, userId, "PhysicalToolInstance", toolId, "UPDATE", { consumedLife: Number(tool.consumedLife), remainingLife: Number(tool.remainingLife), version: tool.version }, { consumedLife: input.consumedLife, remainingLife, version: tool.version + 1, reason: input.reason });
      return tx.physicalToolInstance.findFirstOrThrow({ where: { id: toolId, tenantId } });
    });
  }

  /** Called from ProductionService.start after the existing PLM assertion. */
  async assertStartReady(tx: Tx, tenantId: string, operationId: string, partId: string, machineId?: string) {
    const requirementCount = await tx.operationToolRequirement.count({ where: { tenantId, workOrderOperationId: operationId, isRequired: true } }) + await tx.operationFixtureRequirement.count({ where: { tenantId, workOrderOperationId: operationId, isRequired: true } });
    if (!requirementCount) return;
    const verification = await tx.operationSetupVerification.findFirst({ where: { tenantId, workOrderOperationId: operationId }, orderBy: { createdAt: "desc" }, include: { snapshot: true, assignments: { include: { physicalToolInstance: true, physicalFixtureInstance: true } }, workOrderOperation: true } });
    if (!verification || verification.status !== "VERIFIED" || !verification.snapshot) throw new ConflictException("Operasyon için doğrulanmış takım/fikstür setup'ı bulunmuyor");
    if (verification.machineId !== machineId) throw new ConflictException("Doğrulanan setup makinesi operasyon makinesiyle uyuşmuyor; yeniden doğrulama gerekli");
    if (verification.workOrderOperation.ncProgramId) await this.parts.assertNcProgramUsable(tenantId, verification.workOrderOperation.ncProgramId, partId, machineId, verification.workOrderOperation.ncProgramChecksum ?? undefined, tx);
    if (verification.assignments.some((a) => (a.physicalToolInstance && a.physicalToolInstance.status !== "RESERVED") || (a.physicalFixtureInstance && a.physicalFixtureInstance.status !== "RESERVED"))) throw new ConflictException("Setup kaynağının durumu veya ataması değişmiş; yeniden doğrulama gerekli");
    const snapshotAssignments = (verification.snapshot.payload as any)?.assignments ?? [];
    for (const assignment of verification.assignments) if (assignment.physicalFixtureInstance) {
      const evaluation = await this.fixtureMaintenance.evaluate(tx, tenantId, assignment.physicalFixtureInstance.id);
      const previous = snapshotAssignments.find((item: any) => item.fixture?.id === assignment.physicalFixtureInstanceId)?.fixture?.fixtureCompliance;
      if (evaluation.blockers.length || (previous && (previous.maintenance?.revision !== evaluation.maintenance.revision || previous.calibration?.revision !== evaluation.calibration.revision))) throw new ConflictException("Fikstür bakım/kalibrasyon durumu veya politikası değişti; yeniden doğrulama gerekli");
    }
  }
  async markStarted(tx: Tx, tenantId: string, operationId: string) {
    const verification = await tx.operationSetupVerification.findFirst({ where: { tenantId, workOrderOperationId: operationId, status: "VERIFIED" }, orderBy: { createdAt: "desc" }, include: { assignments: true } });
    if (!verification) return;
    await tx.physicalToolInstance.updateMany({ where: { tenantId, id: { in: verification.assignments.flatMap((a) => a.physicalToolInstanceId ? [a.physicalToolInstanceId] : []) }, status: "RESERVED" }, data: { status: "IN_USE" } });
    await tx.physicalFixtureInstance.updateMany({ where: { tenantId, id: { in: verification.assignments.flatMap((a) => a.physicalFixtureInstanceId ? [a.physicalFixtureInstanceId] : []) }, status: "RESERVED" }, data: { status: "IN_USE" } });
  }
  /** Called atomically by WorkOrdersService completion. Repeated calls use the unique event key and do not consume twice. */
  async completeOperation(tx: Tx, tenantId: string, userId: string | undefined, operationId: string) {
    const verification = await tx.operationSetupVerification.findFirst({ where: { tenantId, workOrderOperationId: operationId, status: "VERIFIED" }, orderBy: { createdAt: "desc" }, include: { snapshot: true, assignments: { where: { isActive: true }, include: { physicalToolInstance: { include: { toolDefinition: true } }, physicalFixtureInstance: true } }, workOrderOperation: true } });
    if (!verification || !verification.snapshot) return;
    for (const assignment of verification.assignments) {
      const tool = assignment.physicalToolInstance;
      if (!tool) continue;
      const key = `operation-complete:${operationId}:${tool.id}`;
      if (await tx.toolLifeEvent.findFirst({ where: { tenantId, idempotencyKey: key } })) continue;
      const amount = this.completionLifeAmount(tool.toolDefinition.lifePolicy, verification.workOrderOperation);
      const before = { consumedLife: Number(tool.consumedLife), remainingLife: Number(tool.remainingLife), version: tool.version };
      const consumedLife = Math.min(Number(tool.toolDefinition.maximumLife), Number(tool.consumedLife) + amount);
      const remainingLife = Math.max(0, Number(tool.toolDefinition.maximumLife) - consumedLife);
      const status = remainingLife <= 0 ? "EXPIRED" : "AVAILABLE";
      const updated = await tx.physicalToolInstance.updateMany({ where: { id: tool.id, tenantId, version: tool.version }, data: { consumedLife, remainingLife, status, lastUsedAt: new Date(), version: { increment: 1 } } });
      if (!updated.count) throw new ConflictException("Takım ömrü eşzamanlı değişti; operasyon tamamlanamadı");
      await tx.toolLifeEvent.create({ data: { tenantId, physicalToolInstanceId: tool.id, workOrderOperationId: operationId, setupSnapshotId: verification.snapshot.id, eventType: "OPERATION_COMPLETE", quantity: amount, idempotencyKey: key, before, after: { consumedLife, remainingLife, version: tool.version + 1 }, createdById: userId } });
    }
    const fixtureIds = [...new Set(verification.assignments.flatMap((a) => a.physicalFixtureInstanceId ? [a.physicalFixtureInstanceId] : []))];
    if (fixtureIds.length) {
      const completedParts = Math.max(1, Number(verification.workOrderOperation.completedQty));
      const fixtures = await tx.physicalFixtureInstance.findMany({ where: { tenantId, id: { in: fixtureIds }, status: "IN_USE" } });
      for (const fixture of fixtures) {
        const before = { maintenanceCycleCount: Number(fixture.maintenanceCycleCount), maintenancePartCount: Number(fixture.maintenancePartCount), status: fixture.status, version: fixture.version };
        const changed = await tx.physicalFixtureInstance.updateMany({ where: { id: fixture.id, tenantId, status: "IN_USE", version: fixture.version }, data: { status: "AVAILABLE", maintenanceCycleCount: { increment: 1 }, maintenancePartCount: { increment: completedParts }, version: { increment: 1 } } });
        if (!changed.count) throw new ConflictException("Fikstür kullanım sayacı eşzamanlı değişti; operasyon tamamlanamadı");
        if (userId) await this.audit(tx, tenantId, userId, "PhysicalFixtureInstance", fixture.id, "UPDATE", before, { maintenanceCycleCount: before.maintenanceCycleCount + 1, maintenancePartCount: before.maintenancePartCount + completedParts, status: "AVAILABLE", version: fixture.version + 1, reason: "OPERATION_COMPLETE", operationId });
      }
    }
    await tx.operationSetupAssignment.updateMany({ where: { tenantId, verificationId: verification.id, isActive: true }, data: { isActive: false, releasedAt: new Date() } });
    await tx.operationSetupVerification.update({ where: { id: verification.id }, data: { status: "RELEASED", version: { increment: 1 } } });
    if (userId) await this.audit(tx, tenantId, userId, "OperationSetupVerification", verification.id, "STATUS_CHANGE", { status: "VERIFIED" }, { status: "RELEASED", operationId });
  }

  async copyRecipeRequirements(tx: Tx, tenantId: string, recipeStepId: string, workOrderOperationId: string) {
    const [tools, fixtures] = await Promise.all([tx.operationToolRequirement.findMany({ where: { tenantId, recipeStepId } }), tx.operationFixtureRequirement.findMany({ where: { tenantId, recipeStepId } })]);
    if (tools.length) await tx.operationToolRequirement.createMany({ data: tools.map(({ id, recipeStepId: _recipeStepId, workOrderOperationId: _workOrderOperationId, createdAt, updatedAt, ...x }) => ({ ...x, tenantId, workOrderOperationId })) });
    if (fixtures.length) await tx.operationFixtureRequirement.createMany({ data: fixtures.map(({ id, recipeStepId: _recipeStepId, workOrderOperationId: _workOrderOperationId, createdAt, updatedAt, ...x }) => ({ ...x, tenantId, workOrderOperationId })) });
  }

  private async operationWithRequirements(tx: Tx, tenantId: string, operationId: string) {
    const operation = await tx.workOrderOperation.findFirst({ where: { id: operationId, tenantId }, include: { workOrder: { select: { partId: true } }, toolRequirements: true, fixtureRequirements: true } });
    if (!operation) throw new NotFoundException("İş emri operasyonu bulunamadı"); return operation;
  }
  private async setupDetail(client: Pick<PrismaService, "operationSetupVerification"> | Tx, tenantId: string, operationId: string) { return client.operationSetupVerification.findFirst({ where: { tenantId, workOrderOperationId: operationId }, orderBy: { createdAt: "desc" }, include: { machine: { select: { id: true, name: true } }, assignments: { include: { toolRequirement: true, fixtureRequirement: true, physicalToolInstance: { include: { toolDefinition: true, toolAssembly: true } }, physicalFixtureInstance: { include: { fixtureDefinition: true } } } }, snapshot: true } }); }
  private assertRequirements(operation: Awaited<ReturnType<ToolingService["operationWithRequirements"]>>, assignments: Array<{ toolRequirementId: string | null; fixtureRequirementId: string | null }>) {
    const validate = (requirements: Array<{ id: string; isRequired: boolean; quantity: number; alternativeGroup: string | null }>, assigned: Array<string>) => {
      const assignedCount = new Map<string, number>(); for (const id of assigned) assignedCount.set(id, (assignedCount.get(id) ?? 0) + 1);
      const groups = new Map<string, typeof requirements>();
      for (const r of requirements.filter((x) => x.isRequired)) { if (r.alternativeGroup) groups.set(r.alternativeGroup, [...(groups.get(r.alternativeGroup) ?? []), r]); else if ((assignedCount.get(r.id) ?? 0) < r.quantity) throw new ConflictException(`Zorunlu setup gereksinimi karşılanmadı: ${r.id}`); }
      for (const [group, rs] of groups) { const need = Math.max(...rs.map((r) => r.quantity)); const actual = rs.reduce((n, r) => n + (assignedCount.get(r.id) ?? 0), 0); if (actual < need) throw new ConflictException(`Alternatif setup grubu karşılanmadı: ${group}`); }
    };
    validate(operation.toolRequirements, assignments.flatMap((a) => a.toolRequirementId ? [a.toolRequirementId] : []));
    validate(operation.fixtureRequirements, assignments.flatMap((a) => a.fixtureRequirementId ? [a.fixtureRequirementId] : []));
  }
  private async validateToolAssignment(tx: Tx, tenantId: string, machineId: string, assignment: any) {
    const tool = assignment.physicalToolInstance; const req = assignment.toolRequirement;
    if (!tool || !req || TOOL_UNAVAILABLE.includes(tool.status)) throw new ConflictException("Takım kullanılabilir durumda değil");
    if (Number(tool.remainingLife) <= 0) throw new ConflictException("Takımın kalan ömrü yetersiz");
    const matches = (req.toolDefinitionId && tool.toolDefinitionId === req.toolDefinitionId) || (req.toolAssemblyId && tool.toolAssemblyId === req.toolAssemblyId);
    if (!matches) throw new ConflictException("Atanan takım operasyon gereksinimiyle uyumsuz");
    const compatibility = await tx.toolMachineCompatibility.findFirst({ where: { tenantId, machineId, OR: [{ toolDefinitionId: tool.toolDefinitionId }, ...(tool.toolAssemblyId ? [{ toolAssemblyId: tool.toolAssemblyId }] : [])] } });
    if (!compatibility) throw new ConflictException("Takım seçilen makineyle uyumlu değil");
    const other = await tx.operationSetupAssignment.findFirst({ where: { tenantId, physicalToolInstanceId: tool.id, isActive: true, verificationId: { not: assignment.verificationId } } }); if (other) throw new ConflictException("Fiziksel takım başka aktif operasyona rezerve edildi");
  }
  private async validateFixtureAssignment(tx: Tx, tenantId: string, machineId: string, assignment: any) {
    const fixture = assignment.physicalFixtureInstance; const req = assignment.fixtureRequirement;
    if (!fixture || !req || FIXTURE_UNAVAILABLE.includes(fixture.status)) throw new ConflictException("Fikstür kullanılabilir durumda değil");
    if (fixture.fixtureDefinitionId !== req.fixtureDefinitionId) throw new ConflictException("Atanan fikstür operasyon gereksinimiyle uyumsuz");
    if (!await tx.fixtureMachineCompatibility.findFirst({ where: { tenantId, machineId, fixtureDefinitionId: fixture.fixtureDefinitionId } })) throw new ConflictException("Fikstür seçilen makineyle uyumlu değil");
    const other = await tx.operationSetupAssignment.findFirst({ where: { tenantId, physicalFixtureInstanceId: fixture.id, isActive: true, verificationId: { not: assignment.verificationId } } }); if (other) throw new ConflictException("Fiziksel fikstür başka aktif operasyona rezerve edildi");
  }
  private snapshotPayload(tenantId: string, operation: any, assignments: any[], userId: string, fixtureCompliance = new Map<string, any>()) { return { tenantId, workOrderOperation: { id: operation.id, seq: operation.seq, name: operation.name }, machine: { id: operation.machineId }, ncProgram: operation.ncProgramId ? { id: operation.ncProgramId, revision: operation.ncProgramVersion, checksum: operation.ncProgramChecksum } : null, assignments: assignments.map((a) => a.physicalToolInstance ? { requirement: a.toolRequirement, tool: { id: a.physicalToolInstance.id, serialNo: a.physicalToolInstance.serialNo, definition: { id: a.physicalToolInstance.toolDefinition.id, code: a.physicalToolInstance.toolDefinition.code, revision: a.physicalToolInstance.toolDefinition.revision }, assembly: a.physicalToolInstance.toolAssembly ? { id: a.physicalToolInstance.toolAssembly.id, code: a.physicalToolInstance.toolAssembly.code, revision: a.physicalToolInstance.toolAssembly.revision } : null, consumedLife: Number(a.physicalToolInstance.consumedLife), remainingLife: Number(a.physicalToolInstance.remainingLife) } } : { requirement: a.fixtureRequirement, fixture: { id: a.physicalFixtureInstance.id, serialNo: a.physicalFixtureInstance.serialNo, definition: { id: a.physicalFixtureInstance.fixtureDefinition.id, code: a.physicalFixtureInstance.fixtureDefinition.code, revision: a.physicalFixtureInstance.fixtureDefinition.revision }, fixtureCompliance: fixtureCompliance.get(a.physicalFixtureInstance.id) } }), verifiedById: userId, verifiedAt: new Date().toISOString() }; }
  private completionLifeAmount(policy: string, operation: { completedQty: any; startedAt: Date | null }) { if (policy === "PART_COUNT") return Math.max(1, Number(operation.completedQty)); if (policy === "TIME") return Math.max(0, ((Date.now() - (operation.startedAt?.getTime() ?? Date.now())) / 60000)); return 1; }
  private async releaseVerification(tx: Tx, tenantId: string, verificationId: string, reason: string) { const assignments = await tx.operationSetupAssignment.findMany({ where: { tenantId, verificationId, isActive: true } }); await tx.physicalToolInstance.updateMany({ where: { tenantId, id: { in: assignments.flatMap((a) => a.physicalToolInstanceId ? [a.physicalToolInstanceId] : []) }, status: "RESERVED" }, data: { status: "AVAILABLE" } }); await tx.physicalFixtureInstance.updateMany({ where: { tenantId, id: { in: assignments.flatMap((a) => a.physicalFixtureInstanceId ? [a.physicalFixtureInstanceId] : []) }, status: "RESERVED" }, data: { status: "AVAILABLE" } }); await tx.operationSetupAssignment.updateMany({ where: { tenantId, verificationId, isActive: true }, data: { isActive: false, releasedAt: new Date() } }); await tx.operationSetupVerification.update({ where: { id: verificationId }, data: { status: "INVALIDATED", invalidatedAt: new Date(), invalidatedReason: reason, version: { increment: 1 } } }); }
  private async audit(tx: Tx, tenantId: string, userId: string, entity: string, entityId: string, action: "CREATE" | "UPDATE" | "STATUS_CHANGE", before: any, after: any) { await tx.auditLog.create({ data: { tenantId, userId, entity, entityId, action, before, after } }); }
  private async assertMachine(tenantId: string, id: string, tx: Pick<PrismaService, "machine"> = this.prisma) { const v = await tx.machine.findFirst({ where: { id, tenantId, isActive: true } }); if (!v) throw new NotFoundException("Makine bulunamadı"); return v; }
  private async assertToolDefinition(tenantId: string, id: string) { const v = await this.prisma.toolDefinition.findFirst({ where: { id, tenantId } }); if (!v) throw new NotFoundException("Takım tanımı bulunamadı"); return v; }
  private async assertAssembly(tenantId: string, id: string) { const v = await this.prisma.toolAssembly.findFirst({ where: { id, tenantId } }); if (!v) throw new NotFoundException("Takım assembly bulunamadı"); return v; }
  private async assertFixtureDefinition(tenantId: string, id: string) { const v = await this.prisma.fixtureDefinition.findFirst({ where: { id, tenantId } }); if (!v) throw new NotFoundException("Fikstür tanımı bulunamadı"); return v; }
  private async assertPhysicalTool(tenantId: string, id: string) { const v = await this.prisma.physicalToolInstance.findFirst({ where: { id, tenantId } }); if (!v) throw new NotFoundException("Fiziksel takım bulunamadı"); return v; }
  private async assertRecipeStep(tenantId: string, id: string) { const v = await this.prisma.recipeStep.findFirst({ where: { id, tenantId } }); if (!v) throw new NotFoundException("Recipe step bulunamadı"); return v; }
  private async assertOperation(tenantId: string, id: string, tx: Pick<PrismaService, "workOrderOperation"> = this.prisma) { const v = await tx.workOrderOperation.findFirst({ where: { id, tenantId } }); if (!v) throw new NotFoundException("İş emri operasyonu bulunamadı"); return v; }
  private async assertRequirementSubject(tenantId: string, dto: { toolDefinitionId?: string; toolAssemblyId?: string }) { if (dto.toolDefinitionId) await this.assertToolDefinition(tenantId, dto.toolDefinitionId); else if (dto.toolAssemblyId) await this.assertAssembly(tenantId, dto.toolAssemblyId); else throw new ConflictException("Takım gereksinimi gerekli"); }
}
