import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CompleteFixtureMaintenanceDto, FixtureCalibrationPolicyDto, FixtureCalibrationRecordDto, FixtureMaintenancePolicyDto, ScheduleFixtureMaintenanceDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

type Tx = Prisma.TransactionClient;
type PolicyEvaluation = { state: string; enforcement: string; policyId?: string; revision?: number; lastAt?: Date | null; dueAt?: Date | null; recordId?: string; validUntil?: Date | null; certificateDocumentId?: string | null; warnings: string[]; blockers: string[] };

@Injectable()
export class FixtureMaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, fixtureDefinitionId?: string) {
    const where = { tenantId, ...(fixtureDefinitionId ? { fixtureDefinitionId } : {}) };
    return Promise.all([
      this.prisma.fixtureMaintenancePolicy.findMany({ where, orderBy: { updatedAt: "desc" } }),
      this.prisma.fixtureCalibrationPolicy.findMany({ where, orderBy: { updatedAt: "desc" } }),
    ]).then(([maintenancePolicies, calibrationPolicies]) => ({ maintenancePolicies, calibrationPolicies }));
  }
  async createMaintenancePolicy(tenantId: string, userId: string, dto: FixtureMaintenancePolicyDto) {
    await this.definition(tenantId, dto.fixtureDefinitionId);
    if (dto.isActive && await this.prisma.fixtureMaintenancePolicy.findFirst({ where: { tenantId, fixtureDefinitionId: dto.fixtureDefinitionId, policyType: dto.policyType, isActive: true } })) throw new ConflictException("Bu fikstür için aynı türde aktif bakım politikası zaten var");
    try { return await this.prisma.$transaction(async (tx) => { const policy = await tx.fixtureMaintenancePolicy.create({ data: { tenantId, ...dto } }); await this.audit(tx, tenantId, userId, "FixtureMaintenancePolicy", policy.id, "CREATE", null, { ...dto, revision: policy.revision }); return policy; }); } catch (error: any) { if (error?.code === "P2002") throw new ConflictException("Bu fikstür için aynı türde aktif bakım politikası zaten var"); throw error; }
  }
  async updateMaintenancePolicy(tenantId: string, userId: string, id: string, dto: Partial<FixtureMaintenancePolicyDto> & { version: number }) {
    const { version, ...data } = dto;
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.fixtureMaintenancePolicy.findFirst({ where: { id, tenantId } });
      if (!before || before.revision !== version) throw new ConflictException("Bakım politikası başka bir işlemde değişti veya bulunamadı");
      const result = await tx.fixtureMaintenancePolicy.updateMany({ where: { id, tenantId, revision: version }, data: { ...data, revision: { increment: 1 } } });
      if (!result.count) throw new ConflictException("Bakım politikası başka bir işlemde değişti veya bulunamadı");
      const updated = await tx.fixtureMaintenancePolicy.findFirstOrThrow({ where: { id, tenantId } });
      await this.audit(tx, tenantId, userId, "FixtureMaintenancePolicy", id, "UPDATE", before, updated);
      return updated;
    });
  }
  async createCalibrationPolicy(tenantId: string, userId: string, dto: FixtureCalibrationPolicyDto) {
    await this.definition(tenantId, dto.fixtureDefinitionId);
    if (dto.isActive && await this.prisma.fixtureCalibrationPolicy.findFirst({ where: { tenantId, fixtureDefinitionId: dto.fixtureDefinitionId, isActive: true } })) throw new ConflictException("Bu fikstür için aktif kalibrasyon politikası zaten var");
    try { return await this.prisma.$transaction(async (tx) => { const policy = await tx.fixtureCalibrationPolicy.create({ data: { tenantId, ...dto } }); await this.audit(tx, tenantId, userId, "FixtureCalibrationPolicy", policy.id, "CREATE", null, { ...dto, revision: policy.revision }); return policy; }); } catch (error: any) { if (error?.code === "P2002") throw new ConflictException("Bu fikstür için aktif kalibrasyon politikası zaten var"); throw error; }
  }
  async updateCalibrationPolicy(tenantId: string, userId: string, id: string, dto: Partial<FixtureCalibrationPolicyDto> & { version: number }) {
    const { version, ...data } = dto;
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.fixtureCalibrationPolicy.findFirst({ where: { id, tenantId } });
      if (!before || before.revision !== version) throw new ConflictException("Kalibrasyon politikası başka bir işlemde değişti veya bulunamadı");
      const result = await tx.fixtureCalibrationPolicy.updateMany({ where: { id, tenantId, revision: version }, data: { ...data, revision: { increment: 1 } } });
      if (!result.count) throw new ConflictException("Kalibrasyon politikası başka bir işlemde değişti veya bulunamadı");
      const updated = await tx.fixtureCalibrationPolicy.findFirstOrThrow({ where: { id, tenantId } });
      await this.audit(tx, tenantId, userId, "FixtureCalibrationPolicy", id, "UPDATE", before, updated);
      return updated;
    });
  }

  async schedule(tenantId: string, userId: string, dto: ScheduleFixtureMaintenanceDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.fixtureMaintenanceEvent.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } });
      if (existing) return existing;
      const fixture = await this.fixture(tx, tenantId, dto.physicalFixtureInstanceId);
      if (dto.fixtureMaintenancePolicyId) {
        const policy = await tx.fixtureMaintenancePolicy.findFirst({ where: { id: dto.fixtureMaintenancePolicyId, tenantId, fixtureDefinitionId: fixture.fixtureDefinitionId, isActive: true } });
        if (!policy) throw new NotFoundException("Aktif fikstür bakım politikası bulunamadı");
      }
      await this.document(tx, tenantId, dto.documentId);
      let event: any;
      try { event = await tx.fixtureMaintenanceEvent.create({ data: { tenantId, physicalFixtureInstanceId: dto.physicalFixtureInstanceId, fixtureMaintenancePolicyId: dto.fixtureMaintenancePolicyId, maintenanceType: dto.maintenanceType, notes: dto.notes, documentId: dto.documentId, idempotencyKey: dto.idempotencyKey, createdById: userId } }); }
      catch (error: any) { if (error?.code === "P2002") { const known = await tx.fixtureMaintenanceEvent.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (known) return known; throw new ConflictException("Bakım planlama isteği eşzamanlı değişti"); } throw error; }
      await this.audit(tx, tenantId, userId, "FixtureMaintenanceEvent", event.id, "CREATE", null, { status: "PLANNED", fixtureId: dto.physicalFixtureInstanceId });
      return event;
    });
  }
  async start(tenantId: string, userId: string, eventId: string, version: number) {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.fixtureMaintenanceEvent.findFirst({ where: { id: eventId, tenantId } }); if (!event) throw new NotFoundException("Bakım kaydı bulunamadı");
      if (event.status === "IN_PROGRESS" || event.status === "COMPLETED") return event;
      if (event.status !== "PLANNED" || event.version !== version) throw new ConflictException("Bakım kaydı güncel değil veya başlatılamaz");
      const fixture = await this.fixture(tx, tenantId, event.physicalFixtureInstanceId);
      if (fixture.status !== "AVAILABLE") throw new ConflictException("Rezerve veya kullanımda olan fikstürde bakım başlatılamaz");
      const moved = await tx.physicalFixtureInstance.updateMany({ where: { id: fixture.id, tenantId, version: fixture.version, status: "AVAILABLE" }, data: { status: "MAINTENANCE", version: { increment: 1 } } });
      if (!moved.count) throw new ConflictException("Fikstür durumu eşzamanlı değişti");
      const result = await tx.fixtureMaintenanceEvent.update({ where: { id: event.id }, data: { status: "IN_PROGRESS", startedAt: new Date(), version: { increment: 1 } } });
      await this.audit(tx, tenantId, userId, "FixtureMaintenanceEvent", event.id, "STATUS_CHANGE", { status: event.status }, { status: "IN_PROGRESS" });
      return result;
    });
  }
  async complete(tenantId: string, userId: string, eventId: string, dto: CompleteFixtureMaintenanceDto) {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.fixtureMaintenanceEvent.findFirst({ where: { id: eventId, tenantId } }); if (!event) throw new NotFoundException("Bakım kaydı bulunamadı");
      if (event.status === "COMPLETED" || event.status === "FAILED") return event;
      if (event.status !== "IN_PROGRESS" || event.version !== dto.version) throw new ConflictException("Bakım kaydı güncel değil veya tamamlanamaz");
      await this.document(tx, tenantId, dto.documentId);
      const fixture = await this.fixture(tx, tenantId, event.physicalFixtureInstanceId);
      if (fixture.status !== "MAINTENANCE") throw new ConflictException("Fikstür bakım durumunda değil");
      const policy = event.fixtureMaintenancePolicyId ? await tx.fixtureMaintenancePolicy.findFirst({ where: { id: event.fixtureMaintenancePolicyId, tenantId, fixtureDefinitionId: fixture.fixtureDefinitionId } }) : null;
      const currentCounter = policy ? this.counterForPolicy(fixture, policy.policyType) : undefined;
      if (currentCounter !== undefined && ((dto.counterBefore !== undefined && dto.counterBefore !== currentCounter) || (dto.counterAfter !== undefined && dto.counterAfter !== currentCounter))) throw new ConflictException("Bakım sayacı güncel fixture sayacıyla uyuşmuyor; düzeltme için yetkili override kullanın");
      const status = dto.result === "PASS" ? "COMPLETED" : "FAILED";
      let claim: { count: number };
      try { claim = await tx.fixtureMaintenanceEvent.updateMany({ where: { id: event.id, tenantId, status: "IN_PROGRESS", version: dto.version }, data: { status, result: dto.result, notes: dto.notes ?? event.notes, documentId: dto.documentId ?? event.documentId, counterBefore: dto.counterBefore ?? currentCounter, counterAfter: dto.counterAfter ?? currentCounter, completionIdempotencyKey: dto.idempotencyKey, completedAt: new Date(), version: { increment: 1 } } }); }
      catch (error: any) { if (error?.code === "P2002") throw new ConflictException("Bu bakım tamamlama kimliği başka bir kayıtta kullanıldı"); throw error; }
      if (!claim.count) {
        const current = await tx.fixtureMaintenanceEvent.findFirst({ where: { id: event.id, tenantId } });
        if (current?.completionIdempotencyKey === dto.idempotencyKey && (current.status === "COMPLETED" || current.status === "FAILED")) return current;
        throw new ConflictException("Bakım kaydı başka bir işlemde değişti veya tamamlanamaz");
      }
      const nextStatus = dto.result === "PASS" ? "AVAILABLE" : "QUARANTINED";
      const moved = await tx.physicalFixtureInstance.updateMany({ where: { id: fixture.id, tenantId, version: fixture.version, status: "MAINTENANCE" }, data: { status: nextStatus, version: { increment: 1 } } });
      if (!moved.count) throw new ConflictException("Fikstür durumu eşzamanlı değişti");
      const updated = await tx.fixtureMaintenanceEvent.findFirstOrThrow({ where: { id: event.id, tenantId } });
      await this.audit(tx, tenantId, userId, "FixtureMaintenanceEvent", event.id, "STATUS_CHANGE", { status: event.status }, { status: updated.status, result: dto.result, counterBefore: dto.counterBefore, counterAfter: dto.counterAfter });
      return updated;
    });
  }
  async calibration(tenantId: string, userId: string, dto: FixtureCalibrationRecordDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.fixtureCalibrationRecord.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (existing) return existing;
      const fixture = await this.fixture(tx, tenantId, dto.physicalFixtureInstanceId);
      const policy = await tx.fixtureCalibrationPolicy.findFirst({ where: { tenantId, fixtureDefinitionId: fixture.fixtureDefinitionId, isActive: true }, orderBy: { revision: "desc" } });
      if (dto.result === "PASS" && policy?.certificateRequired && !dto.certificateDocumentId) throw new ConflictException("Bu kalibrasyon politikası PASS sonucu için sertifika belgesi gerektirir");
      await this.document(tx, tenantId, dto.certificateDocumentId);
      let record: any;
      try { record = await tx.fixtureCalibrationRecord.create({ data: { tenantId, ...dto, createdById: userId } }); }
      catch (error: any) { if (error?.code === "P2002") { const known = await tx.fixtureCalibrationRecord.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (known) return known; throw new ConflictException("Kalibrasyon kaydı eşzamanlı değişti"); } throw error; }
      await this.audit(tx, tenantId, userId, "FixtureCalibrationRecord", record.id, "CREATE", null, { fixtureId: fixture.id, result: dto.result, validUntil: dto.validUntil });
      return record;
    });
  }
  async invalidateCalibration(tenantId: string, userId: string, id: string, input: { version: number; reason: string }) {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.fixtureCalibrationRecord.findFirst({ where: { id, tenantId } }); if (!record) throw new NotFoundException("Kalibrasyon kaydı bulunamadı");
      if (record.invalidatedAt || record.version !== input.version) throw new ConflictException("Kalibrasyon kaydı güncel değil veya zaten geçersiz");
      const updated = await tx.fixtureCalibrationRecord.update({ where: { id }, data: { invalidatedAt: new Date(), invalidatedById: userId, invalidationReason: input.reason, version: { increment: 1 } } });
      await this.audit(tx, tenantId, userId, "FixtureCalibrationRecord", id, "UPDATE", { invalidatedAt: null, version: record.version }, { invalidatedAt: updated.invalidatedAt, version: updated.version, reason: input.reason });
      return updated;
    });
  }
  async adjustCounters(tenantId: string, userId: string, fixtureId: string, input: { maintenanceCycleCount: number; maintenancePartCount: number; version: number; reason: string }) {
    return this.prisma.$transaction(async (tx) => {
      const fixture = await this.fixture(tx, tenantId, fixtureId);
      if (fixture.version !== input.version) throw new ConflictException("Fikstür sayacı başka bir işlemde değişti; güncel sürümü kullanın");
      if (fixture.status === "IN_USE" || fixture.status === "RESERVED") throw new ConflictException("Rezerve veya kullanımda olan fikstürün sayacı düzeltilemez");
      const before = { maintenanceCycleCount: Number(fixture.maintenanceCycleCount), maintenancePartCount: Number(fixture.maintenancePartCount), version: fixture.version };
      const result = await tx.physicalFixtureInstance.updateMany({ where: { id: fixtureId, tenantId, version: input.version }, data: { maintenanceCycleCount: input.maintenanceCycleCount, maintenancePartCount: input.maintenancePartCount, version: { increment: 1 } } });
      if (!result.count) throw new ConflictException("Fikstür sayacı başka bir işlemde değişti; tekrar deneyin");
      const after = { maintenanceCycleCount: input.maintenanceCycleCount, maintenancePartCount: input.maintenancePartCount, version: fixture.version + 1, reason: input.reason };
      await this.audit(tx, tenantId, userId, "PhysicalFixtureInstance", fixtureId, "UPDATE", before, after);
      return tx.physicalFixtureInstance.findFirstOrThrow({ where: { id: fixtureId, tenantId } });
    });
  }
  async history(tenantId: string, fixtureId: string) { await this.fixture(this.prisma, tenantId, fixtureId); return { maintenance: await this.prisma.fixtureMaintenanceEvent.findMany({ where: { tenantId, physicalFixtureInstanceId: fixtureId }, orderBy: { createdAt: "desc" } }), calibration: await this.prisma.fixtureCalibrationRecord.findMany({ where: { tenantId, physicalFixtureInstanceId: fixtureId }, orderBy: { calibratedAt: "desc" } }) }; }
  async due(tenantId: string) { const fixtures = await this.prisma.physicalFixtureInstance.findMany({ where: { tenantId }, include: { fixtureDefinition: true } }); return Promise.all(fixtures.map(async (fixture) => ({ fixture, evaluation: await this.evaluate(this.prisma, tenantId, fixture.id) }))); }
  evaluateForTenant(tenantId: string, fixtureId: string) { return this.evaluate(this.prisma, tenantId, fixtureId); }

  async evaluate(db: Tx | PrismaService, tenantId: string, fixtureId: string): Promise<{ maintenance: PolicyEvaluation; calibration: PolicyEvaluation; warnings: string[]; blockers: string[] }> {
    const fixture = await this.fixture(db, tenantId, fixtureId);
    const [maintenancePolicy, calibrationPolicy, lastMaintenance, lastCalibration] = await Promise.all([
      db.fixtureMaintenancePolicy.findFirst({ where: { tenantId, fixtureDefinitionId: fixture.fixtureDefinitionId, isActive: true }, orderBy: { revision: "desc" } }),
      db.fixtureCalibrationPolicy.findFirst({ where: { tenantId, fixtureDefinitionId: fixture.fixtureDefinitionId, isActive: true }, orderBy: { revision: "desc" } }),
      db.fixtureMaintenanceEvent.findMany({ where: { tenantId, physicalFixtureInstanceId: fixture.id, status: "COMPLETED", result: "PASS" }, orderBy: { completedAt: "desc" } }),
      db.fixtureCalibrationRecord.findFirst({ where: { tenantId, physicalFixtureInstanceId: fixture.id, invalidatedAt: null }, orderBy: { calibratedAt: "desc" } }),
    ]);
    const now = new Date();
    const maintenance = this.maintenanceEvaluation(maintenancePolicy, lastMaintenance.find((event: any) => event.fixtureMaintenancePolicyId === maintenancePolicy?.id), fixture, now);
    const calibration = this.calibrationEvaluation(calibrationPolicy, lastCalibration, now);
    return { maintenance, calibration, warnings: [...maintenance.warnings, ...calibration.warnings], blockers: [...maintenance.blockers, ...calibration.blockers] };
  }
  private maintenanceEvaluation(policy: any, event: any, fixture: any, now: Date): PolicyEvaluation {
    if (!policy) return { state: "NOT_REQUIRED", enforcement: "INFORMATIONAL", warnings: [], blockers: [] };
    const base = { enforcement: policy.enforcement, policyId: policy.id, revision: policy.revision, lastAt: event?.completedAt ?? null, warnings: [] as string[], blockers: [] as string[] };
    if (!event) return this.policyResult({ ...base, state: "UNKNOWN" }, "Bu politika için doğrulanmış bakım kaydı yok");
    if (policy.policyType !== "TIME") {
      const baseline = Number(event.counterAfter);
      if (!Number.isFinite(baseline)) return this.policyResult({ ...base, state: "UNKNOWN" }, "Bakım sayacı kaydı yok");
      const used = this.counterForPolicy(fixture, policy.policyType) - baseline;
      const remaining = Number(policy.interval) - used;
      return this.policyResult({ ...base, state: used >= Number(policy.interval) ? "OVERDUE" : remaining <= Number(policy.warningThreshold ?? 0) ? "WARNING" : "CURRENT" }, used >= Number(policy.interval) ? "Fikstür bakım sayacı vadesi geçti" : remaining <= Number(policy.warningThreshold ?? 0) ? "Fikstür bakım sayaç eşiğine yaklaştı" : undefined);
    }
    const dueAt = new Date(new Date(event.completedAt).getTime() + Number(policy.interval) * 86400000);
    const warningAt = policy.warningThreshold == null ? dueAt : new Date(dueAt.getTime() - Number(policy.warningThreshold) * 86400000);
    return this.policyResult({ ...base, state: now >= dueAt ? "OVERDUE" : now >= warningAt ? "WARNING" : "CURRENT", dueAt }, now >= dueAt ? "Fikstür bakımı vadesi geçti" : now >= warningAt ? "Fikstür bakımı yaklaşıyor" : undefined);
  }
  private calibrationEvaluation(policy: any, record: any, now: Date): PolicyEvaluation {
    if (!policy) return { state: "NOT_REQUIRED", enforcement: "INFORMATIONAL", warnings: [], blockers: [] };
    const base = { enforcement: policy.enforcement, policyId: policy.id, revision: policy.revision, recordId: record?.id, validUntil: record?.validUntil ?? null, certificateDocumentId: record?.certificateDocumentId ?? null, warnings: [] as string[], blockers: [] as string[] };
    if (!record || record.result !== "PASS" || (policy.certificateRequired && !record.certificateDocumentId)) return this.policyResult({ ...base, state: "MISSING" }, "Geçerli PASS kalibrasyon kaydı veya sertifikası yok");
    const warningAt = new Date(new Date(record.validUntil).getTime() - (policy.warningDays ?? 0) * 86400000);
    return this.policyResult({ ...base, state: now > record.validUntil ? "OVERDUE" : now >= warningAt ? "WARNING" : "CURRENT" }, now > record.validUntil ? "Fikstür kalibrasyonunun geçerliliği doldu" : now >= warningAt ? "Fikstür kalibrasyonunun vadesi yaklaşıyor" : undefined);
  }
  private policyResult(value: PolicyEvaluation, issue?: string) {
    if (!issue) return value;
    // A warning threshold is intentionally advisory even when the eventual due state is BLOCKING.
    if (value.state === "WARNING" || value.enforcement !== "BLOCKING") value.warnings.push(issue); else value.blockers.push(issue);
    return value;
  }
  private counterForPolicy(fixture: any, policyType: string) { return Number(policyType === "CYCLE" ? fixture.maintenanceCycleCount : fixture.maintenancePartCount); }
  private async fixture(db: Tx | PrismaService, tenantId: string, id: string) { const fixture = await db.physicalFixtureInstance.findFirst({ where: { id, tenantId }, include: { fixtureDefinition: true } }); if (!fixture) throw new NotFoundException("Fikstür bulunamadı"); return fixture; }
  private async definition(tenantId: string, id: string) { const item = await this.prisma.fixtureDefinition.findFirst({ where: { id, tenantId } }); if (!item) throw new NotFoundException("Fikstür tanımı bulunamadı"); return item; }
  private async document(tx: Tx, tenantId: string, id?: string) { if (!id) return; if (!await tx.document.findFirst({ where: { id, tenantId } })) throw new NotFoundException("Belge bulunamadı"); }
  private audit(tx: Tx, tenantId: string, userId: string, entity: string, entityId: string, action: "CREATE" | "UPDATE" | "STATUS_CHANGE", before: any, after: any) { return tx.auditLog.create({ data: { tenantId, userId, entity, entityId, action, before, after } }); }
}
