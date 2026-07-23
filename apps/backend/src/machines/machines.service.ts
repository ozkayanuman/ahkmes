import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateMachineDto, UpdateMachineDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class MachinesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.machine.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  }

  async findOne(tenantId: string, id: string) {
    const machine = await this.prisma.machine.findFirst({ where: { id, tenantId } });
    if (!machine) throw new NotFoundException("Tezgah bulunamadı");
    return machine;
  }

  create(tenantId: string, dto: CreateMachineDto) {
    return this.prisma.machine.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateMachineDto) {
    await this.findOne(tenantId, id);
    return this.prisma.machine.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    // Tezgahlar silinmez, pasife alınır (iş emri geçmişi korunur)
    return this.prisma.machine.update({ where: { id }, data: { isActive: false } });
  }
}
