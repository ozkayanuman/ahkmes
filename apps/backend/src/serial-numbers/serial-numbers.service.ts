import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateSerialNumberDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SerialNumbersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, partId?: string) {
    return this.prisma.serialNumber.findMany({
      where: { tenantId, ...(partId ? { partId } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const serial = await this.prisma.serialNumber.findFirst({ where: { id, tenantId } });
    if (!serial) throw new NotFoundException("Seri numarası bulunamadı");
    return serial;
  }

  async create(tenantId: string, dto: CreateSerialNumberDto) {
    const part = await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    if (dto.workOrderId) {
      const wo = await this.prisma.workOrder.findFirst({ where: { id: dto.workOrderId, tenantId } });
      if (!wo) throw new NotFoundException("İş emri bulunamadı");
    }
    if (dto.lotId) {
      const lot = await this.prisma.lot.findFirst({ where: { id: dto.lotId, tenantId } });
      if (!lot) throw new NotFoundException("Lot bulunamadı");
    }

    try {
      return await this.prisma.serialNumber.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu seri numarası zaten kayıtlı");
      }
      throw e;
    }
  }

  /**
   * Lot'un backward-trace'iyle aynı desen (bkz. lots.service.ts): seri numarası
   * hep bir "mamul birimi" olduğundan sadece geri izlenebilirlik anlamlı — bu
   * birimi üreten iş emri + o iş emrinin tükettiği malzeme lotları.
   */
  async trace(tenantId: string, id: string) {
    const serial = await this.findOne(tenantId, id);
    if (!serial.workOrderId) return { serial, producedByWorkOrder: null };

    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id: serial.workOrderId, tenantId },
      select: {
        id: true,
        woNo: true,
        status: true,
        part: { select: { id: true, partNo: true, name: true } },
        consumptions: {
          where: { lotId: { not: null } },
          include: { material: { select: { id: true, code: true, name: true } }, lot: true },
        },
      },
    });
    return { serial, producedByWorkOrder: workOrder };
  }

  /** Barkod/QR tarama ile arama — lots.service.ts scanByCode ile aynı desen. */
  async scanByCode(tenantId: string, serialNo: string) {
    const serial = await this.prisma.serialNumber.findFirst({ where: { tenantId, serialNo } });
    if (!serial) throw new NotFoundException("Bu koda ait seri numarası bulunamadı");
    return this.trace(tenantId, serial.id);
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.serialNumber.delete({ where: { id } });
  }
}
