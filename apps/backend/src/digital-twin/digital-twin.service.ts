import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateMachineConnectionDto, UpdateMachinePositionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OeeCalculationService, type OeeCalculationRequest } from "../oee/oee-calculation.service";

const MACHINE_SELECT = {
  id: true, name: true, model: true, controller: true, isActive: true, plantId: true,
  lastStatus: true, lastEventAt: true, posX: true, posY: true, runtimeHours: true,
  activeWorkOrder: { select: { id: true, woNo: true, status: true } },
} as const;

type TwinCalculationContext = Omit<OeeCalculationRequest, "tenantId" | "workOrderId">;

interface MachineMetrics {
  oeeToday: number | null;
  goodCountToday: number;
  scrapCountToday: number;
  dataQuality: string | null;
  energyTodayKwh: number;
  openAlarmCount: number;
}

function emptyMetrics(): MachineMetrics {
  return { oeeToday: null, goodCountToday: 0, scrapCountToday: 0, dataQuality: null, energyTodayKwh: 0, openAlarmCount: 0 };
}

/**
 * Digital Twin is a presentation projection.  OEE comes only from the
 * canonical calculator; energy and live alarm counts remain presentation facts.
 */
@Injectable()
export class DigitalTwinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculation: OeeCalculationService,
  ) {}

  async layout(tenantId: string, context: TwinCalculationContext) {
    const cutoff = new Date(Math.min(context.to.getTime(), context.asOf.getTime()));
    const [machines, connections] = await Promise.all([
      this.prisma.machine.findMany({
        where: { tenantId, plantId: context.plantId },
        select: MACHINE_SELECT,
        orderBy: { name: "asc" },
      }),
      this.prisma.machineConnection.findMany({ where: { tenantId } }),
    ]);
    if (machines.length === 0) return { machines: [], connections };

    const [metrics, energyReadings, openAlarms] = await Promise.all([
      this.metricsByMachine(tenantId, machines, context),
      this.prisma.energyReading.groupBy({
        by: ["machineId"],
        where: { tenantId, machineId: { in: machines.map((machine) => machine.id) }, recordedAt: { gte: context.from, lte: cutoff } },
        _sum: { kwh: true },
      }),
      this.prisma.machineStatusEvent.groupBy({
        by: ["machineId"],
        where: { tenantId, machineId: { in: machines.map((machine) => machine.id) }, type: "ALARM", acknowledgedAt: null },
        _count: { _all: true },
      }),
    ]);
    const energyByMachine = new Map(energyReadings.map((row) => [row.machineId, Number(row._sum.kwh ?? 0)]));
    const alarmCountByMachine = new Map(openAlarms.map((row) => [row.machineId, row._count._all]));

    return {
      machines: machines.map((machine) => ({
        ...machine,
        runtimeHours: Number(machine.runtimeHours),
        ...(metrics.get(machine.id) ?? emptyMetrics()),
        energyTodayKwh: energyByMachine.get(machine.id) ?? 0,
        openAlarmCount: alarmCountByMachine.get(machine.id) ?? 0,
      })),
      connections,
      asOf: cutoff,
    };
  }

  private async metricsByMachine(
    tenantId: string,
    machines: readonly { id: string; activeWorkOrder: { id: string } | null }[],
    context: TwinCalculationContext,
  ): Promise<Map<string, MachineMetrics>> {
    const workOrderIds = [...new Set(machines.flatMap((machine) => machine.activeWorkOrder ? [machine.activeWorkOrder.id] : []))];
    const calculations = new Map(await Promise.all(workOrderIds.map(async (workOrderId) => [
      workOrderId,
      await this.calculation.calculate({ tenantId, ...context, workOrderId }),
    ] as const)));

    return new Map(machines.map((machine) => {
      const report = machine.activeWorkOrder ? calculations.get(machine.activeWorkOrder.id) : undefined;
      return [machine.id, report ? {
        oeeToday: report.metrics.oee.value,
        goodCountToday: report.metrics.facts.goodCount,
        scrapCountToday: report.metrics.facts.scrapCount,
        dataQuality: report.metrics.dataQuality,
        energyTodayKwh: 0,
        openAlarmCount: 0,
      } : emptyMetrics()] as const;
    }));
  }

  async setPosition(tenantId: string, machineId: string, dto: UpdateMachinePositionDto) {
    const machine = await this.prisma.machine.findFirst({ where: { id: machineId, tenantId } });
    if (!machine) throw new NotFoundException("Makine bulunamadı");
    return this.prisma.machine.update({ where: { id: machineId }, data: { posX: dto.posX, posY: dto.posY }, select: MACHINE_SELECT });
  }

  async createConnection(tenantId: string, dto: CreateMachineConnectionDto) {
    if (dto.fromMachineId === dto.toMachineId) throw new ConflictException("Bir makine kendisine bağlanamaz");
    const [from, to] = await Promise.all([
      this.prisma.machine.findFirst({ where: { id: dto.fromMachineId, tenantId } }),
      this.prisma.machine.findFirst({ where: { id: dto.toMachineId, tenantId } }),
    ]);
    if (!from || !to) throw new NotFoundException("Makine bulunamadı");
    try {
      return await this.prisma.machineConnection.create({ data: { tenantId, fromMachineId: dto.fromMachineId, toMachineId: dto.toMachineId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Bu bağlantı zaten var");
      throw error;
    }
  }

  async removeConnection(tenantId: string, id: string) {
    const connection = await this.prisma.machineConnection.findFirst({ where: { id, tenantId } });
    if (!connection) throw new NotFoundException("Bağlantı bulunamadı");
    return this.prisma.machineConnection.delete({ where: { id } });
  }
}
