import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateInspectionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NonConformanceService } from "../non-conformance/non-conformance.service";
import { nextDocNo } from "../common/numbering";

const INSPECTION_INCLUDE = {
  workOrder: { select: { id: true, woNo: true } },
  inspectedBy: { select: { id: true, name: true } },
  nonConformance: { select: { id: true, failureType: true, status: true } },
} as const;

/** Kalite kontrol noktası (checkpoint) kaydı — NonConformance'ın (bir bulgu
 * kaydı) aksine burası bir muayene olayıdır. FAIL sonucunda otomatik olarak
 * NonConformance üretilir (ProductionService'in NonConformanceService'i
 * çapraz-modül çağırdığı mevcut desenle tutarlı). */
@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly nonConformance: NonConformanceService,
  ) {}

  findAll(tenantId: string, workOrderId?: string) {
    return this.prisma.inspection.findMany({
      where: { tenantId, ...(workOrderId ? { workOrderId } : {}) },
      include: INSPECTION_INCLUDE,
      orderBy: { inspectedAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const ins = await this.prisma.inspection.findFirst({ where: { id, tenantId }, include: INSPECTION_INCLUDE });
    if (!ins) throw new NotFoundException("Muayene kaydı bulunamadı");
    return ins;
  }

  async create(tenantId: string, userId: string, dto: CreateInspectionDto) {
    const wo = await this.prisma.workOrder.findFirst({ where: { id: dto.workOrderId, tenantId } });
    if (!wo) throw new NotFoundException("İş emri bulunamadı");

    let nonConformanceId: string | undefined;
    if (dto.result === "FAIL") {
      const nc = await this.nonConformance.create(tenantId, userId, {
        workOrderId: dto.workOrderId,
        productionRunId: dto.productionRunId,
        failureType: `Muayene hatası: ${dto.checkpointName}`,
        description: dto.notes,
        actionType: "GENERIC",
      });
      nonConformanceId = nc.id;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const insNo = await nextDocNo(tx, "inspection", "insNo", "MUA");
      return tx.inspection.create({
        data: {
          tenantId,
          insNo,
          workOrderId: dto.workOrderId,
          productionRunId: dto.productionRunId,
          checkpointName: dto.checkpointName,
          result: dto.result,
          notes: dto.notes,
          nonConformanceId,
          inspectedById: userId,
        },
        include: INSPECTION_INCLUDE,
      });
    });

    this.realtime.emitToTenant(tenantId, "inspection.created", {
      id: created.id,
      workOrderId: dto.workOrderId,
      result: dto.result,
    });
    return created;
  }
}
