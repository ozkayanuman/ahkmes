import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateQualityPlanDto, CreateQualityPlanRevisionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { writeTransactionalAudit } from "../common/transactional-audit";

@Injectable()
export class QualityPlansService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.qualityPlan.findMany({
      where: { tenantId }, include: { part: { select: { id: true, partNo: true, name: true } }, checks: { orderBy: { seq: "asc" } } }, orderBy: { updatedAt: "desc" },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateQualityPlanDto) {
    if (dto.partId) {
      const part = await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } });
      if (!part) throw new NotFoundException("Parça bulunamadı");
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.qualityPlan.create({
          data: {
            tenantId,
            name: dto.name,
            revision: dto.revision ?? "A",
            partId: dto.partId,
            checks: { create: dto.checks.map((check) => ({ ...check, tenantId })) },
          },
          include: { checks: { orderBy: { seq: "asc" } } },
        });
        await writeTransactionalAudit(tx, {
          tenantId,
          userId,
          entity: "quality-plans",
          entityId: created.id,
          action: "CREATE",
          after: created,
        });
        return created;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("Bu ad ve revizyonla bir kalite plani zaten var");
      }
      throw error;
    }
  }

  async createRevision(tenantId: string, userId: string, sourceId: string, dto: CreateQualityPlanRevisionDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const source = await tx.qualityPlan.findFirst({
          where: { id: sourceId, tenantId },
          include: { checks: { orderBy: { seq: "asc" } } },
        });
        if (!source) throw new NotFoundException("Kalite planı bulunamadı");
        if (!source.isActive) throw new ConflictException("Yalnızca aktif kalite planı revize edilebilir");
        if (source.revision === dto.revision) throw new ConflictException("Yeni revizyon kaynak revizyondan farklı olmalı");

        const created = await tx.qualityPlan.create({
          data: {
            tenantId,
            name: source.name,
            revision: dto.revision,
            partId: source.partId,
            checks: {
              create: source.checks.map((check) => ({
                tenantId,
                seq: check.seq,
                checkpointName: check.checkpointName,
                operationSeq: check.operationSeq,
                unit: check.unit,
                lowerLimit: check.lowerLimit,
                upperLimit: check.upperLimit,
                requiresMeasurement: check.requiresMeasurement,
              })),
            },
          },
          include: { checks: { orderBy: { seq: "asc" } } },
        });
        await tx.qualityPlan.update({ where: { id: source.id }, data: { isActive: false } });
        await writeTransactionalAudit(tx, {
          tenantId,
          userId,
          entity: "quality-plans",
          entityId: source.id,
          action: "STATUS_CHANGE",
          before: { revision: source.revision, isActive: true },
          after: { revision: source.revision, isActive: false, supersededById: created.id },
        });
        await writeTransactionalAudit(tx, {
          tenantId,
          userId,
          entity: "quality-plans",
          entityId: created.id,
          action: "CREATE",
          after: { ...created, supersedesId: source.id },
        });
        return created;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("Bu ad ve revizyonla bir kalite planı zaten var");
      }
      throw error;
    }
  }
}
