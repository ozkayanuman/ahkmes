import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateMaterialDto, UpdateMaterialDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, q?: string) {
    return this.prisma.material.findMany({
      where: {
        tenantId,
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" as const } },
                { name: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { code: "asc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const material = await this.prisma.material.findFirst({ where: { id, tenantId } });
    if (!material) throw new NotFoundException("Malzeme bulunamadı");
    return material;
  }

  async create(tenantId: string, dto: CreateMaterialDto) {
    try {
      return await this.prisma.material.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu malzeme kodu zaten kayıtlı");
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateMaterialDto) {
    try {
      // Keep the tenant predicate on the write itself, not only on a prior read.
      // This prevents a future caller from turning a scoped lookup into an
      // unscoped cross-tenant mutation by changing the code between the calls.
      const updated = await this.prisma.material.updateMany({ where: { id, tenantId }, data: dto });
      if (updated.count === 0) throw new NotFoundException("Malzeme bulunamadı");
      return this.findOne(tenantId, id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu malzeme kodu zaten kayıtlı");
      }
      throw e;
    }
  }

  async remove(tenantId: string, id: string) {
    const material = await this.findOne(tenantId, id);
    try {
      const deleted = await this.prisma.material.deleteMany({ where: { id, tenantId } });
      if (deleted.count === 0) throw new NotFoundException("Malzeme bulunamadı");
      return material;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException("Malzemeye bağlı kayıtlar var (PO/tüketim), silinemez");
      }
      throw e;
    }
  }
}
