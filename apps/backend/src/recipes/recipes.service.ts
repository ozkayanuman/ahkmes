import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateRecipeHeaderDto, EngineeringStatusChangeDto, UpdateRecipeHeaderDto } from "@ahkmes/shared-types";

type RecipeStepInput = CreateRecipeHeaderDto["steps"][number];
import { PrismaService } from "../prisma/prisma.service";
import { PartsService } from "../parts/parts.service";
import { sanitizeInstructionHtml } from "./recipe-instruction-sanitizer";
import { writeTransactionalAudit } from "../common/transactional-audit";

const RECIPE_INCLUDE = {
  part: { select: { id: true, partNo: true, name: true } },
  steps: { orderBy: { seq: "asc" as const } },
} as const;

/**
 * Süreç reçetesi (Recipe) versiyonlama — BomService ile aynı desen (bir Part için
 * aynı anda tek aktif revizyon, app-level kontrol, Prisma partial unique index yok).
 */
@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService, private readonly parts?: PartsService) {}

  findAll(tenantId: string, partId?: string) {
    return this.prisma.recipeHeader.findMany({
      where: { tenantId, ...(partId ? { partId } : {}) },
      include: RECIPE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const recipe = await this.prisma.recipeHeader.findFirst({ where: { id, tenantId }, include: RECIPE_INCLUDE });
    if (!recipe) throw new NotFoundException("Reçete bulunamadı");
    return recipe;
  }

  async create(tenantId: string, dto: CreateRecipeHeaderDto) {
    const part = await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    for (const step of dto.steps) {
      if (step.ncProgramId) await this.ncPrograms().assertNcProgramUsable(tenantId, step.ncProgramId, part.id);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        return tx.recipeHeader.create({
          data: {
            tenantId,
            partId: dto.partId,
            revision: dto.revision,
            notes: dto.notes,
            isActive: false,
            status: "DRAFT",
            steps: {
              create: dto.steps.map((s: RecipeStepInput) => ({
                tenantId,
                seq: s.seq,
                name: s.name,
                parameterName: s.parameterName,
                parameterValue: s.parameterValue,
                unit: s.unit,
                ncProgramId: s.ncProgramId,
                standardMinutes: s.standardMinutes,
                idealCycleTimeSec: s.idealCycleTimeSec,
                instructionHtml: sanitizeInstructionHtml(s.instructionHtml),
              })),
            },
          },
          include: RECIPE_INCLUDE,
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu parça/revizyon için reçete zaten kayıtlı");
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateRecipeHeaderDto) {
    const recipe = await this.findOne(tenantId, id);
    if (recipe.status !== "DRAFT") throw new ConflictException("Released, obsolete, or legacy routing cannot be changed; create a new revision");
    if (dto.steps) {
      for (const step of dto.steps) {
        if (step.ncProgramId) await this.ncPrograms().assertNcProgramUsable(tenantId, step.ncProgramId, recipe.partId);
      }
      // MES-OPERATOR-HMI-002: RecipeStep.id gömülü resimlerin (Document.entityId)
      // kararlı anahtarı — id'siz gönderilenler yeni adım, id'liler mevcut adımın
      // upsert güncellemesi. Eskiden burada tüm adımlar silinip yeniden
      // oluşturuluyordu; bu, id'ye bağlı her resmi bir sonraki düzenlemede
      // yetim bırakıyordu.
      const existingIds = new Set(recipe.steps.map((s: { id: string }) => s.id));
      const unknownId = dto.steps.find((s) => s.id && !existingIds.has(s.id));
      if (unknownId) throw new NotFoundException("Güncellenecek reçete adımı bu reçetede bulunamadı");
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.steps) {
        const incomingIds = new Set(dto.steps.filter((s) => s.id).map((s) => s.id as string));
        const toDeleteIds = recipe.steps
          .map((s: { id: string }) => s.id)
          .filter((existingId: string) => !incomingIds.has(existingId));
        if (toDeleteIds.length > 0) {
          await tx.recipeStep.deleteMany({ where: { id: { in: toDeleteIds }, recipeHeaderId: recipe.id } });
        }
        for (const s of dto.steps as RecipeStepInput[]) {
          const data = {
            seq: s.seq,
            name: s.name,
            parameterName: s.parameterName,
            parameterValue: s.parameterValue,
            unit: s.unit,
            ncProgramId: s.ncProgramId,
            standardMinutes: s.standardMinutes,
            idealCycleTimeSec: s.idealCycleTimeSec,
            instructionHtml: sanitizeInstructionHtml(s.instructionHtml),
          };
          if (s.id) {
            await tx.recipeStep.update({ where: { id: s.id }, data });
          } else {
            await tx.recipeStep.create({ data: { tenantId, recipeHeaderId: recipe.id, ...data } });
          }
        }
      }
      return tx.recipeHeader.update({
        where: { id: recipe.id },
        data: { notes: dto.notes },
        include: RECIPE_INCLUDE,
      });
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.recipeHeader.delete({ where: { id } });
  }

  async setStatus(tenantId: string, userId: string, id: string, dto: EngineeringStatusChangeDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RecipeHeader" WHERE "id" = ${id} FOR UPDATE`;
      const recipe = await tx.recipeHeader.findFirst({ where: { id, tenantId }, include: { steps: true } });
      if (!recipe) throw new NotFoundException("Routing was not found");
      if (recipe.status === dto.status) return recipe;
      if (dto.status === "RELEASED") {
        if (!recipe.steps.length) throw new ConflictException("Released routing must contain at least one operation");
        const duplicate = recipe.steps.some((step, index) => step.seq !== index + 1);
        if (duplicate) throw new ConflictException("Routing operation sequence must be contiguous and start at 1");
        for (const step of recipe.steps) if (step.ncProgramId) await this.ncPrograms().assertNcProgramUsable(tenantId, step.ncProgramId, recipe.partId, undefined, undefined, tx);
        await tx.recipeHeader.updateMany({ where: { tenantId, partId: recipe.partId, status: "RELEASED", id: { not: recipe.id } }, data: { status: "OBSOLETE", isActive: false } });
      }
      const updated = await tx.recipeHeader.update({ where: { id }, data: { status: dto.status, isActive: dto.status === "RELEASED", releasedAt: dto.status === "RELEASED" ? new Date() : recipe.releasedAt, releasedById: dto.status === "RELEASED" ? userId : recipe.releasedById } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "routing", entityId: id, action: "STATUS_CHANGE", before: { status: recipe.status }, after: { status: updated.status, revision: recipe.revision } });
      return updated;
    });
  }

  private ncPrograms() {
    if (!this.parts) throw new ConflictException("NC program policy service is unavailable");
    return this.parts;
  }
}
