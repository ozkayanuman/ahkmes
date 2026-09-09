import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AppException } from "../common/app-exception";
import { PrismaService } from "../prisma/prisma.service";

type Db = PrismaService | Prisma.TransactionClient;

export interface MachineMaintenanceAvailability {
  machineId: string;
  maintenanceState: "AVAILABLE" | "MAINTENANCE_DUE" | "PLANNED_MAINTENANCE" | "BREAKDOWN" | "OUT_OF_SERVICE";
  productionAllowed: boolean;
  reasonCode?: "MACHINE_MAINTENANCE_BLOCK" | "MACHINE_OUT_OF_SERVICE";
  activeBlockingMaintenanceOrderId?: string;
}

/** Shared read-only production-safety projection over CMMS-owned machine state. */
@Injectable()
export class MachineMaintenanceAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async status(tenantId: string, machineId: string, at = new Date(), db: Db = this.prisma): Promise<MachineMaintenanceAvailability> {
    const client = db as any;
    const machine = await client.machine.findFirst({ where: { id: machineId, tenantId, isActive: true }, select: { id: true, maintenanceState: true } });
    if (!machine) throw new NotFoundException("Tezgah bulunamadı veya pasif");
    const maintenanceState = (machine.maintenanceState ?? "AVAILABLE") as MachineMaintenanceAvailability["maintenanceState"];
    const activeWindow = await client.maintenanceOrder.findFirst({
      where: { tenantId, machineId, status: { notIn: ["COMPLETED", "CANCELLED"] }, blockingFrom: { lte: at }, blockingUntil: { gte: at } },
      select: { id: true },
      orderBy: { blockingFrom: "asc" },
    });
    if (maintenanceState === "OUT_OF_SERVICE") return { machineId, maintenanceState, productionAllowed: false, reasonCode: "MACHINE_OUT_OF_SERVICE", ...(activeWindow ? { activeBlockingMaintenanceOrderId: activeWindow.id } : {}) };
    if (maintenanceState === "BREAKDOWN" || maintenanceState === "PLANNED_MAINTENANCE" || activeWindow) return { machineId, maintenanceState, productionAllowed: false, reasonCode: "MACHINE_MAINTENANCE_BLOCK", ...(activeWindow ? { activeBlockingMaintenanceOrderId: activeWindow.id } : {}) };
    return { machineId, maintenanceState, productionAllowed: true };
  }

  async assertProductionAvailable(tenantId: string, machineId: string, at = new Date(), db: Db = this.prisma) {
    const availability = await this.status(tenantId, machineId, at, db);
    if (!availability.productionAllowed) {
      throw new AppException(
        HttpStatus.CONFLICT,
        availability.reasonCode!,
        availability.reasonCode === "MACHINE_OUT_OF_SERVICE" ? "Machine is explicitly out of service" : "Machine is blocked by maintenance",
      );
    }
    return availability;
  }
}
