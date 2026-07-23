import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateSupplierDto, UpdateSupplierDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, q?: string) {
    return this.prisma.supplier.findMany({
      where: {
        tenantId,
        ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!supplier) throw new NotFoundException("Tedarikçi bulunamadı");
    return supplier;
  }

  create(tenantId: string, dto: CreateSupplierDto) {
    return this.prisma.supplier.create({ data: { ...dto, tenantId, email: dto.email || null } });
  }

  async update(tenantId: string, id: string, dto: UpdateSupplierDto) {
    await this.findOne(tenantId, id);
    return this.prisma.supplier.update({
      where: { id },
      data: { ...dto, email: dto.email || null },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    try {
      return await this.prisma.supplier.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException("Tedarikçiye bağlı satınalma emirleri var, silinemez");
      }
      throw e;
    }
  }
}
