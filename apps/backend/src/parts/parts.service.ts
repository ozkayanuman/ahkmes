import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateNcProgramDto, CreatePartDto, UpdatePartDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PartsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, q?: string) {
    return this.prisma.part.findMany({
      where: {
        tenantId,
        ...(q
          ? {
              OR: [
                { partNo: { contains: q, mode: "insensitive" as const } },
                { name: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      include: { stock: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const part = await this.prisma.part.findFirst({
      where: { id, tenantId },
      include: { stock: true, ncPrograms: { orderBy: { version: "desc" } } },
    });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    return part;
  }

  async create(tenantId: string, dto: CreatePartDto) {
    try {
      return await this.prisma.part.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu parça no + revizyon zaten kayıtlı");
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdatePartDto) {
    await this.findOne(tenantId, id);
    try {
      return await this.prisma.part.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu parça no + revizyon zaten kayıtlı");
      }
      throw e;
    }
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    try {
      return await this.prisma.part.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException("Parçaya bağlı kayıtlar var (teklif/iş emri), silinemez");
      }
      throw e;
    }
  }

  async addNcProgram(tenantId: string, userId: string, dto: CreateNcProgramDto) {
    await this.findOne(tenantId, dto.partId);
    const latest = await this.prisma.ncProgram.findFirst({
      where: { partId: dto.partId },
      orderBy: { version: "desc" },
    });
    return this.prisma.ncProgram.create({
      data: {
        ...dto,
        tenantId,
        version: (latest?.version ?? 0) + 1,
        createdById: userId,
      },
    });
  }

  listNcPrograms(tenantId: string, partId: string) {
    return this.prisma.ncProgram.findMany({
      where: { tenantId, partId },
      orderBy: { version: "desc" },
    });
  }
}
