import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateMachineConnectionDto, UpdateMachinePositionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

const MACHINE_SELECT = {
  id: true,
  name: true,
  model: true,
  controller: true,
  isActive: true,
  lastStatus: true,
  lastEventAt: true,
  posX: true,
  posY: true,
  activeWorkOrder: { select: { id: true, woNo: true, status: true } },
} as const;

@Injectable()
export class DigitalTwinService {
  constructor(private readonly prisma: PrismaService) {}

  /** 2D saha planı için tüm makineler (konum + canlı durum + atanmış iş emri) + bağlantılar. */
  async layout(tenantId: string) {
    const [machines, connections] = await Promise.all([
      this.prisma.machine.findMany({ where: { tenantId }, select: MACHINE_SELECT, orderBy: { name: "asc" } }),
      this.prisma.machineConnection.findMany({ where: { tenantId } }),
    ]);
    return { machines, connections };
  }

  async setPosition(tenantId: string, machineId: string, dto: UpdateMachinePositionDto) {
    const machine = await this.prisma.machine.findFirst({ where: { id: machineId, tenantId } });
    if (!machine) throw new NotFoundException("Makine bulunamadı");
    return this.prisma.machine.update({
      where: { id: machineId },
      data: { posX: dto.posX, posY: dto.posY },
      select: MACHINE_SELECT,
    });
  }

  async createConnection(tenantId: string, dto: CreateMachineConnectionDto) {
    if (dto.fromMachineId === dto.toMachineId) {
      throw new ConflictException("Bir makine kendisine bağlanamaz");
    }
    const [from, to] = await Promise.all([
      this.prisma.machine.findFirst({ where: { id: dto.fromMachineId, tenantId } }),
      this.prisma.machine.findFirst({ where: { id: dto.toMachineId, tenantId } }),
    ]);
    if (!from || !to) throw new NotFoundException("Makine bulunamadı");
    try {
      return await this.prisma.machineConnection.create({
        data: { tenantId, fromMachineId: dto.fromMachineId, toMachineId: dto.toMachineId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu bağlantı zaten var");
      }
      throw e;
    }
  }

  async removeConnection(tenantId: string, id: string) {
    const conn = await this.prisma.machineConnection.findFirst({ where: { id, tenantId } });
    if (!conn) throw new NotFoundException("Bağlantı bulunamadı");
    return this.prisma.machineConnection.delete({ where: { id } });
  }
}
