import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateRecipeHeaderDto, UpdateRecipeHeaderDto } from "@ahkmes/shared-types";

type RecipeStepInput = CreateRecipeHeaderDto["steps"][number];
import { PrismaService } from "../prisma/prisma.service";
import { PartsService } from "../parts/parts.service";

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
        await tx.recipeHeader.updateMany({
          where: { tenantId, partId: dto.partId, isActive: true },
          data: { isActive: false },
        });
        return tx.recipeHeader.create({
          data: {
            tenantId,
            partId: dto.partId,
            revision: dto.revision,
            notes: dto.notes,
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
    if (dto.steps) {
      for (const step of dto.steps) {
        if (step.ncProgramId) await this.ncPrograms().assertNcProgramUsable(tenantId, step.ncProgramId, recipe.partId);
      }
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.steps) {
        await tx.recipeStep.deleteMany({ where: { recipeHeaderId: recipe.id } });
      }
      return tx.recipeHeader.update({
        where: { id: recipe.id },
        data: {
          notes: dto.notes,
          isActive: dto.isActive,
          ...(dto.steps
            ? {
                steps: {
                  create: dto.steps.map((s: RecipeStepInput) => ({
                    tenantId,
                    seq: s.seq,
                    name: s.name,
                    parameterName: s.parameterName,
                    parameterValue: s.parameterValue,
                    unit: s.unit,
                    ncProgramId: s.ncProgramId,
                  })),
                },
              }
            : {}),
        },
        include: RECIPE_INCLUDE,
      });
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.recipeHeader.delete({ where: { id } });
  }

  private ncPrograms() {
    if (!this.parts) throw new ConflictException("NC program policy service is unavailable");
    return this.parts;
  }
}
