import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateBinDto, UpdateBinDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BinsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, warehouseId?: string) {
    return this.prisma.bin.findMany({
      where: { tenantId, ...(warehouseId ? { warehouseId } : {}) },
      include: { warehouse: { select: { id: true, name: true } } },
      orderBy: { code: "asc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const bin = await this.prisma.bin.findFirst({
      where: { id, tenantId },
      include: { warehouse: { select: { id: true, name: true } } },
    });
    if (!bin) throw new NotFoundException("Raf (bin) bulunamadı");
    return bin;
  }

  /** Bir raftaki mevcut stok bakiyeleri — TransferOrder/CycleCount UI'ının
   * "hangi kalemler var, ne kadar" sorusuna cevap vermesi için. */
  async balances(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.stockBalance.findMany({
      where: { tenantId, binId: id, qty: { not: 0 } },
      include: { lot: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  async create(tenantId: string, dto: CreateBinDto) {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } });
    if (!warehouse) throw new NotFoundException("Depo bulunamadı");
    try {
      return await this.prisma.bin.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu depoda aynı kodda raf zaten kayıtlı");
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateBinDto) {
    await this.findOne(tenantId, id);
    return this.prisma.bin.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    try {
      return await this.prisma.bin.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException("Rafa bağlı stok bakiyesi/hareket var, silinemez");
      }
      throw e;
    }
  }
}
