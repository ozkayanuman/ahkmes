import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { BomLineInputDto, CreateBomHeaderDto, EngineeringStatusChangeDto, UpdateBomHeaderDto } from "@ahkmes/shared-types";
import { writeTransactionalAudit } from "../common/transactional-audit";
import { PrismaService } from "../prisma/prisma.service";
import { UomService } from "../uom/uom.service";

const BOM_INCLUDE = {
  part: { select: { id: true, partNo: true, name: true } },
  lines: { orderBy: { createdAt: "asc" as const } },
} as const;

@Injectable()
export class BomService {
  constructor(private readonly prisma: PrismaService, private readonly uom?: UomService) {}

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
   * Satırların referans verdiği Material/Part'ların gerçekten var olduğunu
   * doğrular, ardından her alt montaj (itemType=PART) satırı için döngü
   * kontrolü yapar: `rootPartId`, kendi (doğrudan veya dolaylı) alt montajı
   * olamaz — aksi halde MRP patlatma/genealogy trace sonsuz döngüye girer.
   * Aktif BOM grafiğinde DFS ile kontrol edilir (bkz. PLAN.md Faz K notu).
   */
  private async validateLines(tenantId: string, rootPartId: string, lines: BomLineInputDto[]) {
    const materialItemIds = lines.filter((l) => l.itemType === "MATERIAL").map((l) => l.itemId);
    const partItemIds = lines.filter((l) => l.itemType === "PART").map((l) => l.itemId);

    const [materials, parts] = await Promise.all([
      materialItemIds.length
        ? this.prisma.material.findMany({ where: { id: { in: materialItemIds }, tenantId } })
        : Promise.resolve([]),
      partItemIds.length
        ? this.prisma.part.findMany({ where: { id: { in: partItemIds }, tenantId } })
        : Promise.resolve([]),
    ]);
    if (materials.length !== new Set(materialItemIds).size) {
      throw new NotFoundException("Malzeme bulunamadı");
    }
    if (parts.length !== new Set(partItemIds).size) {
      throw new NotFoundException("Alt montaj parçası bulunamadı");
    }
    if (this.uom) {
      const materialsById = new Map(materials.map((item) => [item.id, item]));
      const partsById = new Map(parts.map((item) => [item.id, item]));
      for (const line of lines) {
        const canonical = line.itemType === "MATERIAL" ? materialsById.get(line.itemId)?.unit : partsById.get(line.itemId)?.unit;
        if (!canonical) throw new NotFoundException("BOM component UOM could not be resolved");
        if (line.unit) await this.uom.assertCompatible(tenantId, line.unit, canonical);
      }
    }

    for (const childPartId of new Set(partItemIds)) {
      if (childPartId === rootPartId) {
        throw new ConflictException("Bir parça kendi ürün ağacında doğrudan alt montaj olamaz");
      }
      if (await this.subtreeContainsPart(tenantId, childPartId, rootPartId, new Set())) {
        throw new ConflictException(
          "Bu alt montaj döngü oluşturur: seçilen parça, kök parçanın (dolaylı) üst montajı",
        );
      }
    }
  }

  private async subtreeContainsPart(
    tenantId: string,
    startPartId: string,
    targetPartId: string,
    visited: Set<string>,
  ): Promise<boolean> {
    if (startPartId === targetPartId) return true;
    if (visited.has(startPartId)) return false;
    visited.add(startPartId);

    const activeBom = await this.prisma.bomHeader.findFirst({
      where: { tenantId, partId: startPartId, isActive: true },
      include: { lines: { where: { itemType: "PART" } } },
    });
    if (!activeBom) return false;

    for (const line of activeBom.lines) {
      if (await this.subtreeContainsPart(tenantId, line.itemId, targetPartId, visited)) return true;
    }
    return false;
  }

  /**
   * Bir Part için aynı anda tek aktif BOM olabilir — yeni bir aktif BOM
   * oluşturulunca önceki aktif revizyon(lar) pasife çekilir.
   */
  async create(tenantId: string, dto: CreateBomHeaderDto) {
    const part = await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    await this.validateLines(tenantId, dto.partId, dto.lines);

    try {
      return await this.prisma.$transaction(async (tx) => {
        return tx.bomHeader.create({
          data: {
            tenantId,
            partId: dto.partId,
            revision: dto.revision,
            notes: dto.notes,
            isActive: false,
            status: "DRAFT",
            lines: {
              create: dto.lines.map((l) => ({
                tenantId,
                itemType: l.itemType,
                itemId: l.itemId,
                qtyPer: l.qtyPer,
                scrapPct: l.scrapPct,
                unit: l.unit,
                issueMethod: l.issueMethod,
                consumeOnScrap: l.consumeOnScrap,
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
    if (bom.status !== "DRAFT") throw new ConflictException("Released, obsolete, or legacy BOM cannot be changed; create a new revision");
    if (dto.lines) {
      await this.validateLines(tenantId, bom.partId, dto.lines);
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.lines) {
        await tx.bomLine.deleteMany({ where: { bomHeaderId: bom.id } });
      }
      return tx.bomHeader.update({
        where: { id: bom.id },
        data: {
          notes: dto.notes,
          // isActive is derived from the controlled release command.
          ...(dto.lines
            ? {
                lines: {
                  create: dto.lines.map((l) => ({
                    tenantId,
                    itemType: l.itemType,
                    itemId: l.itemId,
                qtyPer: l.qtyPer,
                scrapPct: l.scrapPct,
                unit: l.unit,
                issueMethod: l.issueMethod,
                consumeOnScrap: l.consumeOnScrap,
                  })),
                },
              }
            : {}),
        },
        include: BOM_INCLUDE,
      });
    });
  }

  async setStatus(tenantId: string, userId: string, id: string, dto: EngineeringStatusChangeDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "BomHeader" WHERE "id" = ${id} FOR UPDATE`;
      const bom = await tx.bomHeader.findFirst({ where: { id, tenantId }, include: { lines: true } });
      if (!bom) throw new NotFoundException("BOM was not found");
      if (bom.status === dto.status) return bom;
      if (dto.status === "RELEASED" && !bom.lines.length) throw new ConflictException("Released BOM must contain at least one component");
      if (dto.status === "RELEASED") await tx.bomHeader.updateMany({ where: { tenantId, partId: bom.partId, status: "RELEASED", id: { not: bom.id } }, data: { status: "OBSOLETE", isActive: false } });
      const updated = await tx.bomHeader.update({ where: { id }, data: { status: dto.status, isActive: dto.status === "RELEASED", releasedAt: dto.status === "RELEASED" ? new Date() : bom.releasedAt, releasedById: dto.status === "RELEASED" ? userId : bom.releasedById } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "bom", entityId: id, action: "STATUS_CHANGE", before: { status: bom.status }, after: { status: updated.status, revision: bom.revision } });
      return updated;
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.bomHeader.delete({ where: { id } });
  }
}
