import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { UpsertSupplierMaterialDto } from "@ahkmes/shared-types";
import { writeTransactionalAudit } from "../common/transactional-audit";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SupplierMaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  listForSupplier(tenantId: string, supplierId: string) {
    return this.prisma.supplierMaterial.findMany({
      where: { tenantId, supplierId },
      include: { material: { select: { id: true, code: true, name: true, unit: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  listForMaterial(tenantId: string, materialId: string) {
    return this.prisma.supplierMaterial.findMany({
      where: { tenantId, materialId },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: [{ isPreferred: "desc" }, { createdAt: "asc" }],
    });
  }

  /** isPreferred:true verilirse, bu malzeme için diğer tüm tedarikçilerin
   * tercih işareti kaldırılır — malzeme başına en fazla bir tercih edilen
   * tedarikçi şema tarafından değil burada zorlanır. */
  async upsert(tenantId: string, userId: string, supplierId: string, dto: UpsertSupplierMaterialDto) {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, tenantId } });
    if (!supplier) throw new NotFoundException("Tedarikçi bulunamadı");
    const material = await this.prisma.material.findFirst({ where: { id: dto.materialId, tenantId } });
    if (!material) throw new NotFoundException("Malzeme bulunamadı");
    try {
      return await this.prisma.$transaction(async (tx) => {
      const where = { tenantId_supplierId_materialId: { tenantId, supplierId, materialId: dto.materialId } };
      const before = await tx.supplierMaterial.findUnique({ where });
      if (dto.isPreferred) {
        await tx.supplierMaterial.updateMany({ where: { tenantId, materialId: dto.materialId, NOT: { supplierId } }, data: { isPreferred: false } });
      }
      const link = await tx.supplierMaterial.upsert({
        where,
        create: { tenantId, supplierId, materialId: dto.materialId, isPreferred: dto.isPreferred ?? false, leadTimeDays: dto.leadTimeDays, unitCost: dto.unitCost },
        update: {
          ...(dto.isPreferred !== undefined ? { isPreferred: dto.isPreferred } : {}),
          ...(dto.leadTimeDays !== undefined ? { leadTimeDays: dto.leadTimeDays } : {}),
          ...(dto.unitCost !== undefined ? { unitCost: dto.unitCost } : {}),
        },
        include: { material: { select: { id: true, code: true, name: true, unit: true } } },
      });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "supplier-material", entityId: link.id, action: before ? "UPDATE" : "CREATE", before, after: link });
      return link;
    });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Bu malzeme için başka bir tercihli tedarikçi eşzamanlı olarak kaydedildi; listeyi yenileyip tekrar deneyin");
      }
      throw error;
    }
  }

  async remove(tenantId: string, userId: string, supplierId: string, id: string) {
    const link = await this.prisma.supplierMaterial.findFirst({ where: { id, tenantId, supplierId } });
    if (!link) throw new NotFoundException("Tedarikçi-malzeme ilişkisi bulunamadı");
    await this.prisma.$transaction(async (tx) => {
      await tx.supplierMaterial.delete({ where: { id: link.id } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "supplier-material", entityId: link.id, action: "DELETE", before: link });
    });
    return { id: link.id };
  }

  /**
   * MrpService.decidePurchaseProposal için: verilen malzeme kümesinin hepsi
   * TEK bir ortak tercih edilen tedarikçiye sahipse o tedarikçiyi döner,
   * aksi halde (bazı malzemelerin tercih edilen tedarikçisi yok veya
   * malzemeler farklı tedarikçilere işaret ediyor) null döner — insan hâlâ
   * elle seçmeli.
   */
  async findCommonPreferredSupplier(tenantId: string, inputMaterialIds: string[]): Promise<string | null> {
    const distinctMaterialIds = [...new Set(inputMaterialIds)];
    const materialIds = distinctMaterialIds;
    if (distinctMaterialIds.length === 0) return null;
    const links = await this.prisma.supplierMaterial.findMany({
      where: { tenantId, materialId: { in: distinctMaterialIds }, isPreferred: true },
      select: { materialId: true, supplierId: true },
    });
    const bySupplier = new Map(links.map((l) => [l.materialId, l.supplierId]));
    if (bySupplier.size !== materialIds.length) return null; // en az bir malzemenin tercih edilen tedarikçisi yok
    const distinctSuppliers = new Set(bySupplier.values());
    return distinctSuppliers.size === 1 ? [...distinctSuppliers][0] : null;
  }
}
