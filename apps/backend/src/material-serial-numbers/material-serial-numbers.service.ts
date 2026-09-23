import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateMaterialSerialNumberDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class MaterialSerialNumbersService {
  constructor(private readonly prisma: PrismaService) {}
  findAll(tenantId: string, materialId?: string, lotId?: string) { return this.prisma.materialSerialNumber.findMany({ where: { tenantId, ...(materialId ? { materialId } : {}), ...(lotId ? { lotId } : {}) }, orderBy: { createdAt: "desc" } }); }
  async create(tenantId: string, dto: CreateMaterialSerialNumberDto) {
    const material = await this.prisma.material.findFirst({ where: { id: dto.materialId, tenantId } });
    if (!material) throw new NotFoundException("Malzeme bulunamadı");
    if (!material.serialTrackingRequired) throw new ConflictException("Bu malzeme için seri takibi etkin değil");
    if (dto.lotId) {
      const lot = await this.prisma.lot.findFirst({ where: { id: dto.lotId, tenantId, itemType: "MATERIAL", itemId: dto.materialId } });
      if (!lot) throw new NotFoundException("Seri için seçilen lot bu malzemeye ait değil");
    }
    try { return await this.prisma.materialSerialNumber.create({ data: { ...dto, tenantId } }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Bu hammadde seri numarası zaten kayıtlı"); throw error; }
  }
}
