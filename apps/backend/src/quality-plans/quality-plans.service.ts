import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateQualityPlanDto, CreateQualityPlanRevisionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { writeTransactionalAudit } from "../common/transactional-audit";

@Injectable()
export class QualityPlansService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.qualityPlan.findMany({ where: { tenantId }, include: { part: { select: { id: true, partNo: true, name: true } }, checks: { orderBy: { seq: "asc" } } }, orderBy: { updatedAt: "desc" } });
  }

  async create(tenantId: string, userId: string, dto: CreateQualityPlanDto) {
    if (dto.partId && !await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } })) throw new NotFoundException("Part was not found");
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.qualityPlan.create({ data: { tenantId, name: dto.name, revision: dto.revision ?? "A", partId: dto.partId, isActive: false, status: "DRAFT", samplingMethod: dto.samplingMethod, sampleCount: dto.sampleCount, checks: { create: dto.checks.map((check) => ({ ...check, tenantId })) } }, include: { checks: { orderBy: { seq: "asc" } } } });
        await writeTransactionalAudit(tx, { tenantId, userId, entity: "quality-plan", entityId: created.id, action: "CREATE", after: created });
        return created;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new ConflictException("Quality plan revision already exists");
      throw error;
    }
  }

  async createRevision(tenantId: string, userId: string, sourceId: string, dto: CreateQualityPlanRevisionDto) {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.qualityPlan.findFirst({ where: { id: sourceId, tenantId }, include: { checks: { orderBy: { seq: "asc" } } } });
      if (!source) throw new NotFoundException("Quality plan was not found");
      if (source.status !== "RELEASED") throw new ConflictException("Only a released quality plan can be revised");
      if (source.revision === dto.revision) throw new ConflictException("Revision must differ from source");
      const created = await tx.qualityPlan.create({ data: { tenantId, name: source.name, revision: dto.revision, partId: source.partId, isActive: false, status: "DRAFT", samplingMethod: source.samplingMethod, sampleCount: source.sampleCount, checks: { create: source.checks.map((check) => ({ tenantId, seq: check.seq, checkpointName: check.checkpointName, operationSeq: check.operationSeq, unit: check.unit, lowerLimit: check.lowerLimit, upperLimit: check.upperLimit, requiresMeasurement: check.requiresMeasurement, characteristicType: check.characteristicType, nominalValue: check.nominalValue, qualitativeExpected: check.qualitativeExpected, isRequired: check.isRequired })) } }, include: { checks: { orderBy: { seq: "asc" } } } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "quality-plan", entityId: created.id, action: "CREATE", after: { ...created, supersedesId: source.id } });
      return created;
    });
  }

  async setStatus(tenantId: string, userId: string, id: string, status: "RELEASED" | "OBSOLETE") {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.qualityPlan.findFirst({ where: { id, tenantId }, include: { checks: true } });
      if (!plan) throw new NotFoundException("Quality plan was not found");
      if (status === "RELEASED" && !plan.checks.length) throw new ConflictException("Released quality plan must contain characteristics");
      if (status === "RELEASED" && plan.samplingMethod === "FIXED_COUNT" && !plan.sampleCount) throw new ConflictException("Fixed-count quality plan requires a sample count");
      if (status === "RELEASED") await tx.qualityPlan.updateMany({ where: { tenantId, partId: plan.partId, status: "RELEASED", id: { not: id } }, data: { status: "OBSOLETE", isActive: false } });
      const updated = await tx.qualityPlan.update({ where: { id }, data: { status, isActive: status === "RELEASED" } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "quality-plan", entityId: id, action: "STATUS_CHANGE", before: { status: plan.status }, after: { status: updated.status, revision: plan.revision } });
      return updated;
    });
  }
}
