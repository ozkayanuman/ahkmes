import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, StockItemType } from "@prisma/client";
import type { CreateLotDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class LotsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, itemType?: StockItemType, itemId?: string) {
    return this.prisma.lot.findMany({
      where: { tenantId, ...(itemType ? { itemType } : {}), ...(itemId ? { itemId } : {}) },
      orderBy: { receivedDate: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const lot = await this.prisma.lot.findFirst({ where: { id, tenantId } });
    if (!lot) throw new NotFoundException("Lot bulunamadı");
    return lot;
  }

  async create(tenantId: string, dto: CreateLotDto) {
    const exists =
      dto.itemType === "MATERIAL"
        ? await this.prisma.material.findFirst({ where: { id: dto.itemId, tenantId } })
        : await this.prisma.part.findFirst({ where: { id: dto.itemId, tenantId } });
    if (!exists) throw new NotFoundException(dto.itemType === "MATERIAL" ? "Malzeme bulunamadı" : "Parça bulunamadı");

    try {
      return await this.prisma.lot.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu lot numarası zaten kayıtlı");
      }
      throw e;
    }
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    try {
      return await this.prisma.lot.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException("Lota bağlı stok bakiyesi var, silinemez");
      }
      throw e;
    }
  }
}
