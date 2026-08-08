import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Lot, Prisma } from "@prisma/client";
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

  private static readonly MAX_TRACE_DEPTH = 10;

  /**
   * Lot'un backward-trace'iyle aynı desen (bkz. lots.service.ts): seri numarası
   * hep bir "mamul birimi" olduğundan sadece geri izlenebilirlik anlamlı — bu
   * birimi üreten iş emri + o iş emrinin tükettiği lotlar. Faz K 3: tüketilen bir
   * PART lotu kendi backward zincirine recursive iner (alt montajın alt montajı).
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
        // Faz K: itemType/itemId polimorfik — isim çözümlemesi frontend'de yapılır.
        consumptions: {
          where: { lotId: { not: null } },
          include: { lot: true },
        },
      },
    });
    if (!workOrder) return { serial, producedByWorkOrder: null };

    const consumptions = await Promise.all(
      workOrder.consumptions.map(async (c) => ({
        ...c,
        backward:
          c.lot && c.lot.itemType === "PART"
            ? await this.traceBackward(tenantId, c.lot, 1, new Set([c.lot.id]))
            : null,
      })),
    );
    return { serial, producedByWorkOrder: { ...workOrder, consumptions } };
  }

  /** lots.service.ts'teki traceBackward ile aynı desen (kasıtlı olarak modüller
   * arası bağımlılık kurulmadı — her iki servis de bu izlenebilirlik akışını
   * kendi başına, tek bir Prisma sorgu zincirinden yürütür). */
  private async traceBackward(
    tenantId: string,
    lot: Lot,
    depth: number,
    visited: Set<string>,
  ): Promise<{ producedByWorkOrders: unknown[] }> {
    if (depth >= SerialNumbersService.MAX_TRACE_DEPTH) return { producedByWorkOrders: [] };

    const finishedEntries = await this.prisma.finishedGoodsEntry.findMany({
      where: { tenantId, lotId: lot.id },
      include: {
        workOrder: {
          select: {
            id: true,
            woNo: true,
            status: true,
            consumptions: {
              where: { lotId: { not: null } },
              include: { lot: true },
            },
          },
        },
      },
    });

    const producedByWorkOrders = await Promise.all(
      finishedEntries.map(async (e) => ({
        entry: { id: e.id, quantity: e.quantity, date: e.date },
        workOrder: { id: e.workOrder.id, woNo: e.workOrder.woNo, status: e.workOrder.status },
        consumedLots: await Promise.all(
          e.workOrder.consumptions.map(async (c) => ({
            ...c,
            backward:
              c.lot && c.lot.itemType === "PART" && !visited.has(c.lot.id)
                ? await this.traceBackward(tenantId, c.lot, depth + 1, new Set(visited).add(c.lot.id))
                : null,
          })),
        ),
      })),
    );
    return { producedByWorkOrders };
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
