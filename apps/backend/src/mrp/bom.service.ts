import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateBomHeaderDto, UpdateBomHeaderDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

const BOM_INCLUDE = {
  part: { select: { id: true, partNo: true, name: true } },
  lines: {
    include: { material: { select: { id: true, code: true, name: true, unit: true } } },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

@Injectable()
export class BomService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, partId?: string) {
    return this.prisma.bomHeader.findMany({
      where: { tenantId, ...(partId ? { partId } : {}) },
      include: BOM_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const bom = await this.prisma.bomHeader.findFirst({ where: { id, tenantId }, include: BOM_INCLUDE });
    if (!bom) throw new NotFoundException("Ürün ağacı bulunamadı");
    return bom;
  }

  /**
   * Bir Part için aynı anda tek aktif BOM olabilir — yeni bir aktif BOM
   * oluşturulunca önceki aktif revizyon(lar) pasife çekilir.
   */
  async create(tenantId: string, dto: CreateBomHeaderDto) {
    const part = await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    const materialIds = dto.lines.map((l) => l.materialId);
    const materials = await this.prisma.material.findMany({
      where: { id: { in: materialIds }, tenantId },
    });
    if (materials.length !== new Set(materialIds).size) {
      throw new NotFoundException("Malzeme bulunamadı");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.bomHeader.updateMany({
          where: { tenantId, partId: dto.partId, isActive: true },
          data: { isActive: false },
        });
        return tx.bomHeader.create({
          data: {
            tenantId,
            partId: dto.partId,
            revision: dto.revision,
            notes: dto.notes,
            lines: {
              create: dto.lines.map((l) => ({
                tenantId,
                materialId: l.materialId,
                qtyPer: l.qtyPer,
                scrapPct: l.scrapPct,
              })),
            },
          },
          include: BOM_INCLUDE,
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu parça/revizyon için ürün ağacı zaten kayıtlı");
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateBomHeaderDto) {
    const bom = await this.findOne(tenantId, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.lines) {
        await tx.bomLine.deleteMany({ where: { bomHeaderId: bom.id } });
      }
      return tx.bomHeader.update({
        where: { id: bom.id },
        data: {
          notes: dto.notes,
          isActive: dto.isActive,
          ...(dto.lines
            ? {
                lines: {
                  create: dto.lines.map((l) => ({
                    tenantId,
                    materialId: l.materialId,
                    qtyPer: l.qtyPer,
                    scrapPct: l.scrapPct,
                  })),
                },
              }
            : {}),
        },
        include: BOM_INCLUDE,
      });
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.bomHeader.delete({ where: { id } });
  }
}
