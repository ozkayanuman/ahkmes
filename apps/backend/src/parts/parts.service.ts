import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateNcProgramDto, CreatePartDto, UpdatePartDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { MinioService } from "../documents/minio.service";

// G-kod dosyaları için MIME allowlist — istemcinin gönderdiği mimeType doğrudan
// güvenilmez (bkz. documents.service.ts'teki aynı gerekçe: stored XSS riski).
const ALLOWED_NC_MIME_TYPES = new Set(["text/plain", "application/octet-stream"]);

@Injectable()
export class PartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

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

  private async findNcProgram(tenantId: string, id: string) {
    const program = await this.prisma.ncProgram.findFirst({ where: { id, tenantId } });
    if (!program) throw new NotFoundException("NC programı bulunamadı");
    return program;
  }

  /** G-kod dosyasını MinIO'ya yükler; mevcut versiyon kaydının dosya alanlarını doldurur/değiştirir. */
  async uploadNcProgramFile(
    tenantId: string,
    id: string,
    input: { fileName: string; mimeType: string; buffer: Buffer },
  ) {
    if (!ALLOWED_NC_MIME_TYPES.has(input.mimeType)) {
      throw new BadRequestException(`Desteklenmeyen dosya tipi: ${input.mimeType}`);
    }
    const program = await this.findNcProgram(tenantId, id);
    const storageKey = `${tenantId}/nc-programs/${program.partId}/${program.id}-${input.fileName}`;
    await this.minio.putObject(storageKey, input.buffer, input.mimeType);
    return this.prisma.ncProgram.update({
      where: { id: program.id },
      data: {
        fileName: input.fileName,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
      },
    });
  }

  async getNcProgramFileUrl(tenantId: string, id: string) {
    const program = await this.findNcProgram(tenantId, id);
    if (!program.storageKey) throw new NotFoundException("Bu NC programı için henüz dosya yüklenmemiş");
    const url = await this.minio.presignedGetUrl(program.storageKey, program.fileName);
    return { url, fileName: program.fileName };
  }
}
