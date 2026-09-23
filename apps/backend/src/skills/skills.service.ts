import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateMachineRequiredSkillDto, CreateSkillDto, GrantOperatorSkillDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { writeTransactionalAudit } from "../common/transactional-audit";

const LEVEL_RANK: Record<string, number> = { TRAINEE: 1, QUALIFIED: 2, EXPERT: 3 };

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  listSkills(tenantId: string) {
    return this.prisma.skill.findMany({ where: { tenantId }, orderBy: { code: "asc" } });
  }

  async createSkill(tenantId: string, dto: CreateSkillDto) {
    const existing = await this.prisma.skill.findFirst({ where: { tenantId, code: dto.code } });
    if (existing) throw new ConflictException("Bu kodla bir beceri tanımı zaten var");
    return this.prisma.skill.create({
      data: { tenantId, code: dto.code, name: dto.name, description: dto.description ?? null },
    });
  }

  listOperatorSkills(tenantId: string, operatorId: string) {
    return this.prisma.operatorSkill.findMany({
      where: { tenantId, operatorId },
      include: {
        skill: { select: { id: true, code: true, name: true } },
        grantedBy: { select: { id: true, name: true } },
        revokedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
  }

  async grantOperatorSkill(tenantId: string, grantedById: string, dto: GrantOperatorSkillDto) {
    if (dto.expiresAt && dto.expiresAt <= new Date()) throw new ConflictException("Beceri geçerliliği gelecekte bir tarih olmalı");
    return this.prisma.$transaction(async (tx) => {
      const operator = await tx.user.findFirst({ where: { id: dto.operatorId, tenantId, isActive: true } });
      if (!operator) throw new NotFoundException("Aktif kullanıcı bulunamadı");
      const skill = await tx.skill.findFirst({ where: { id: dto.skillId, tenantId } });
      if (!skill) throw new NotFoundException("Beceri tanımı bulunamadı");
      const before = await tx.operatorSkill.findFirst({ where: { tenantId, operatorId: operator.id, skillId: skill.id } });
      const grant = await tx.operatorSkill.upsert({
        where: { tenantId_operatorId_skillId: { tenantId, operatorId: operator.id, skillId: skill.id } },
        create: {
          tenantId, operatorId: operator.id, skillId: skill.id, level: dto.level, status: "ACTIVE",
          certificateReference: dto.certificateReference ?? null, expiresAt: dto.expiresAt,
          grantedById, grantedAt: new Date(), revokedById: null, revokedAt: null,
        },
        update: {
          level: dto.level, status: "ACTIVE", certificateReference: dto.certificateReference ?? null, expiresAt: dto.expiresAt,
          grantedById, grantedAt: new Date(), revokedById: null, revokedAt: null,
        },
      });
      await writeTransactionalAudit(tx, {
        tenantId, userId: grantedById, entity: "operator-skills", entityId: grant.id,
        action: before ? "UPDATE" : "CREATE", before: before ?? undefined, after: grant,
      });
      return grant;
    });
  }

  async revokeOperatorSkill(tenantId: string, revokedById: string, operatorSkillId: string) {
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.operatorSkill.findFirst({ where: { id: operatorSkillId, tenantId } });
      if (!grant) throw new NotFoundException("Operatör beceri kaydı bulunamadı");
      if (grant.status === "REVOKED") return grant;
      const revoked = await tx.operatorSkill.update({
        where: { id: grant.id },
        data: { status: "REVOKED", revokedById, revokedAt: new Date() },
      });
      await writeTransactionalAudit(tx, {
        tenantId, userId: revokedById, entity: "operator-skills", entityId: revoked.id,
        action: "STATUS_CHANGE", before: grant, after: revoked,
      });
      return revoked;
    });
  }

  async listMachineRequiredSkills(tenantId: string, machineId: string) {
    const machine = await this.prisma.machine.findFirst({ where: { id: machineId, tenantId } });
    if (!machine) throw new NotFoundException("Tezgah bulunamadı");
    return this.prisma.machineRequiredSkill.findMany({
      where: { tenantId, machineId },
      include: { skill: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async addMachineRequiredSkill(tenantId: string, userId: string, machineId: string, dto: CreateMachineRequiredSkillDto) {
    return this.prisma.$transaction(async (tx) => {
      const machine = await tx.machine.findFirst({ where: { id: machineId, tenantId } });
      if (!machine) throw new NotFoundException("Tezgah bulunamadı");
      const skill = await tx.skill.findFirst({ where: { id: dto.skillId, tenantId } });
      if (!skill) throw new NotFoundException("Beceri tanımı bulunamadı");
      const existing = await tx.machineRequiredSkill.findFirst({ where: { tenantId, machineId, skillId: dto.skillId } });
      if (existing) throw new ConflictException("Bu beceri bu makine için zaten gereksinim olarak tanımlı");
      const requirement = await tx.machineRequiredSkill.create({
        data: { tenantId, machineId, skillId: dto.skillId, minLevel: dto.minLevel },
      });
      await writeTransactionalAudit(tx, {
        tenantId, userId, entity: "machine-required-skills", entityId: requirement.id,
        action: "CREATE", after: requirement,
      });
      await this.outbox.record(tx, tenantId, "machine", machineId, "machine.updated", { id: machineId });
      return requirement;
    });
  }

  async removeMachineRequiredSkill(tenantId: string, userId: string, machineId: string, requirementId: string) {
    return this.prisma.$transaction(async (tx) => {
      const requirement = await tx.machineRequiredSkill.findFirst({ where: { id: requirementId, tenantId, machineId } });
      if (!requirement) throw new NotFoundException("Makine beceri gereksinimi bulunamadı");
      await tx.machineRequiredSkill.delete({ where: { id: requirement.id } });
      await writeTransactionalAudit(tx, {
        tenantId, userId, entity: "machine-required-skills", entityId: requirement.id,
        action: "DELETE", before: requirement,
      });
      await this.outbox.record(tx, tenantId, "machine", machineId, "machine.updated", { id: machineId });
      return { id: requirement.id };
    });
  }

  /**
   * HmiService.start() gate: an operator meets a machine's required skills
   * only if every requirement has an ACTIVE, non-expired OperatorSkill grant
   * whose level is at or above the required minLevel.
   */
  async findMissingSkills(tenantId: string, machineId: string, operatorId: string) {
    const requirements = await this.prisma.machineRequiredSkill.findMany({
      where: { tenantId, machineId },
      include: { skill: { select: { code: true, name: true } } },
    });
    if (requirements.length === 0) return [];
    const grants = await this.prisma.operatorSkill.findMany({
      where: {
        tenantId, operatorId, status: "ACTIVE",
        skillId: { in: requirements.map((requirement) => requirement.skillId) },
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
    });
    const grantBySkillId = new Map(grants.map((grant) => [grant.skillId, grant]));
    return requirements.filter((requirement) => {
      const grant = grantBySkillId.get(requirement.skillId);
      return !grant || LEVEL_RANK[grant.level] < LEVEL_RANK[requirement.minLevel];
    });
  }
}
