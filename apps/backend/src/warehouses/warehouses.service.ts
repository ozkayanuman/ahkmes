import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateWarehouseDto, UpdateWarehouseDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, q?: string) {
    return this.prisma.warehouse.findMany({
      where: {
        tenantId,
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      },
      include: { bins: { orderBy: { code: "asc" as const } } },
      orderBy: { name: "asc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const wh = await this.prisma.warehouse.findFirst({
      where: { id, tenantId },
      include: { bins: { orderBy: { code: "asc" as const } } },
    });
    if (!wh) throw new NotFoundException("Depo bulunamadı");
    return wh;
  }

  async create(tenantId: string, dto: CreateWarehouseDto) {
    try {
      return await this.prisma.warehouse.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu depo adı zaten kayıtlı");
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateWarehouseDto) {
    await this.findOne(tenantId, id);
    try {
      return await this.prisma.warehouse.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu depo adı zaten kayıtlı");
      }
      throw e;
    }
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    try {
      return await this.prisma.warehouse.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException("Depoya bağlı raflar (bin) var, silinemez");
      }
      throw e;
    }
  }
}
