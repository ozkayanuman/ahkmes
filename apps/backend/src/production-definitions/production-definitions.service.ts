import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateProductionDefinitionDto, EngineeringStatusChangeDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { writeTransactionalAudit } from "../common/transactional-audit";

@Injectable()
export class ProductionDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, plantId?: string, partId?: string) {
    return this.prisma.productionDefinition.findMany({ where: { tenantId, ...(plantId ? { plantId } : {}), ...(partId ? { partId } : {}) }, include: { plant: { select: { id: true, name: true, timezone: true } }, part: { select: { id: true, partNo: true, revision: true, engineeringStatus: true } }, bomHeader: { select: { id: true, revision: true, status: true } }, recipeHeader: { select: { id: true, revision: true, status: true } } }, orderBy: { updatedAt: "desc" } });
  }

  async create(tenantId: string, userId: string, dto: CreateProductionDefinitionDto) {
    const [plant, part, bom, recipe] = await Promise.all([
      this.prisma.plant.findFirst({ where: { id: dto.plantId, tenantId } }),
      this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } }),
      this.prisma.bomHeader.findFirst({ where: { id: dto.bomHeaderId, tenantId } }),
      this.prisma.recipeHeader.findFirst({ where: { id: dto.recipeHeaderId, tenantId } }),
    ]);
    if (!plant || !part || !bom || !recipe) throw new NotFoundException("Production definition references must belong to the tenant");
    if (bom.partId !== part.id || recipe.partId !== part.id) throw new ConflictException("BOM and routing must belong to the production definition part revision");
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.productionDefinition.create({ data: { tenantId, ...dto } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "production-definition", entityId: created.id, action: "CREATE", after: created });
      return created;
    });
  }

  async setStatus(tenantId: string, userId: string, id: string, dto: EngineeringStatusChangeDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProductionDefinition" WHERE "id" = ${id} FOR UPDATE`;
      const definition = await tx.productionDefinition.findFirst({ where: { id, tenantId }, include: { part: true, bomHeader: true, recipeHeader: { include: { steps: true } } } });
      if (!definition) throw new NotFoundException("Production definition was not found");
      if (definition.status === dto.status) return definition;
      if (dto.status === "RELEASED") {
        if (definition.part.engineeringStatus !== "RELEASED") throw new ConflictException("Part revision must be RELEASED before its production definition");
        if (definition.bomHeader.status !== "RELEASED" || definition.recipeHeader.status !== "RELEASED") throw new ConflictException("BOM and routing must be RELEASED before the production definition");
        if (!definition.recipeHeader.steps.length) throw new ConflictException("Released routing must contain at least one operation");
        const existing = await tx.productionDefinition.findFirst({ where: { tenantId, plantId: definition.plantId, partId: definition.partId, status: "RELEASED", id: { not: id } } });
        if (existing) await tx.productionDefinition.update({ where: { id: existing.id }, data: { status: "OBSOLETE" } });
      }
      const updated = await tx.productionDefinition.update({ where: { id }, data: { status: dto.status, releasedAt: dto.status === "RELEASED" ? new Date() : definition.releasedAt, releasedById: dto.status === "RELEASED" ? userId : definition.releasedById } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "production-definition", entityId: id, action: "STATUS_CHANGE", before: { status: definition.status }, after: { status: updated.status } });
      return updated;
    });
  }
}
