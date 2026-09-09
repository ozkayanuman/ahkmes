import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateCalibrationDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { nextDocNo } from "../common/numbering";

const CALIBRATION_INCLUDE = {
  machine: { select: { id: true, name: true } },
  performedBy: { select: { id: true, name: true } },
} as const;

/** Makine kalibrasyon kaydı — takvim bazlı (nextDueDate). Sertifika/rapor
 * dosyası için Document'in polimorfik entityType="calibration" deseni
 * kullanılır (bkz. DocumentsService), ayrı bir FK gerekmez. */
@Injectable()
export class CalibrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  findAll(tenantId: string, machineId?: string, dueBefore?: string) {
    return this.prisma.calibration.findMany({
      where: {
        tenantId,
        ...(machineId ? { machineId } : {}),
        ...(dueBefore ? { nextDueDate: { lte: new Date(dueBefore) } } : {}),
      },
      include: CALIBRATION_INCLUDE,
      orderBy: { nextDueDate: "asc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const cal = await this.prisma.calibration.findFirst({ where: { id, tenantId }, include: CALIBRATION_INCLUDE });
    if (!cal) throw new NotFoundException("Kalibrasyon kaydı bulunamadı");
    return cal;
  }

  async create(tenantId: string, userId: string, dto: CreateCalibrationDto) {
    const machine = await this.prisma.machine.findFirst({ where: { id: dto.machineId, tenantId } });
    if (!machine) throw new NotFoundException("Makine bulunamadı");

    const created = await this.prisma.$transaction(async (tx) => {
      const kalNo = await nextDocNo(tx, "calibration", "kalNo", "KAL");
      const calibration = await tx.calibration.create({
        data: { ...dto, tenantId, kalNo, performedById: userId },
        include: CALIBRATION_INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "calibration", calibration.id, "calibration.created", { id: calibration.id, machineId: dto.machineId });
      return calibration;
    });
    return created;
  }
}
