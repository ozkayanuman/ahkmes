import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateTransferOrderDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { nextDocNo } from "../common/numbering";

const TO_INCLUDE = {
  fromBin: { select: { id: true, code: true, warehouse: { select: { id: true, name: true } } } },
  toBin: { select: { id: true, code: true, warehouse: { select: { id: true, name: true } } } },
  createdBy: { select: { id: true, name: true } },
  lines: true,
} as const;

/** Bin→Bin transfer — Delivery gibi tek seferlik olay (oluşturulunca anında
 * gerçekleşir). Kaynak ve hedef kontrol/güncellemeleri transaction içinde
 * taze veriyle yapılır (bkz. delivery.service.ts — aynı race-condition
 * önleme deseni). */
@Injectable()
export class TransferOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  findAll(tenantId: string, binId?: string) {
    return this.prisma.transferOrder.findMany({
      where: { tenantId, ...(binId ? { OR: [{ fromBinId: binId }, { toBinId: binId }] } : {}) },
      include: TO_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const to = await this.prisma.transferOrder.findFirst({ where: { id, tenantId }, include: TO_INCLUDE });
    if (!to) throw new NotFoundException("Transfer emri bulunamadı");
    return to;
  }

  async create(tenantId: string, userId: string, dto: CreateTransferOrderDto) {
    if (dto.fromBinId === dto.toBinId) {
      throw new ConflictException("Kaynak ve hedef raf aynı olamaz");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const [fromBin, toBin] = await Promise.all([
        tx.bin.findFirst({ where: { id: dto.fromBinId, tenantId } }),
        tx.bin.findFirst({ where: { id: dto.toBinId, tenantId } }),
      ]);
      if (!fromBin) throw new NotFoundException("Kaynak raf bulunamadı");
      if (!toBin) throw new NotFoundException("Hedef raf bulunamadı");

      for (const line of dto.lines) {
        const fromBalance = await tx.stockBalance.findFirst({
          where: {
            tenantId,
            binId: dto.fromBinId,
            itemType: line.itemType,
            itemId: line.itemId,
            lotId: line.lotId ?? null,
          },
        });
        const currentQty = fromBalance ? Number(fromBalance.qty) : 0;
        if (currentQty < line.qty - 1e-9) {
          throw new ConflictException(
            `Yetersiz bakiye: kaynak rafta ${currentQty} adet mevcut, ${line.qty} adet transfer isteniyor`,
          );
        }
        await tx.stockBalance.update({
          where: { id: fromBalance!.id },
          data: { qty: { decrement: line.qty } },
        });

        const toBalance = await tx.stockBalance.findFirst({
          where: {
            tenantId,
            binId: dto.toBinId,
            itemType: line.itemType,
            itemId: line.itemId,
            lotId: line.lotId ?? null,
          },
        });
        if (toBalance) {
          await tx.stockBalance.update({ where: { id: toBalance.id }, data: { qty: { increment: line.qty } } });
        } else {
          await tx.stockBalance.create({
            data: {
              tenantId,
              binId: dto.toBinId,
              itemType: line.itemType,
              itemId: line.itemId,
              lotId: line.lotId,
              qty: line.qty,
            },
          });
        }
      }

      const toNo = await nextDocNo(tx, "transferOrder", "toNo", "TRF");
      return tx.transferOrder.create({
        data: {
          tenantId,
          toNo,
          fromBinId: dto.fromBinId,
          toBinId: dto.toBinId,
          notes: dto.notes,
          createdById: userId,
          lines: {
            create: dto.lines.map((l) => ({
              tenantId,
              itemType: l.itemType,
              itemId: l.itemId,
              lotId: l.lotId,
              qty: l.qty,
            })),
          },
        },
        include: TO_INCLUDE,
      });
    });

    this.realtime.emitToTenant(tenantId, "transferorder.created", { id: created.id });
    this.realtime.emitToTenant(tenantId, "stock.updated", { reason: "transfer", transferOrderId: created.id });
    return created;
  }
}
