import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateAreaDto,
  CreatePlantDto,
  CreateUnitDto,
  CreateWorkplaceDto,
  UpdateAreaDto,
  UpdatePlantDto,
  UpdateUnitDto,
  UpdateWorkplaceDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

// Hiyerarşi sadece organizasyon yapısını gösterir — canlı durum/atanmış iş
// emri Digital Twin sayfasına ait (bkz. digital-twin modülü), burada karışmaz.
const MACHINE_SELECT = {
  id: true,
  name: true,
  model: true,
} as const;

@Injectable()
export class HierarchyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Digital Twin ve Hiyerarşi sayfası için tam ağaç: Plant > Area > Workplace > Unit > Machine. */
  tree(tenantId: string) {
    return this.prisma.plant.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      include: {
        areas: {
          orderBy: { name: "asc" },
          include: {
            workplaces: {
              orderBy: { name: "asc" },
              include: {
                units: {
                  orderBy: { name: "asc" },
                  include: { machines: { select: MACHINE_SELECT } },
                },
              },
            },
          },
        },
      },
    });
  }

  // ---- Plant ----
  async createPlant(tenantId: string, dto: CreatePlantDto) {
    try {
      return await this.prisma.plant.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu isimde bir tesis (Plant) zaten var");
      }
      throw e;
    }
  }

  async updatePlant(tenantId: string, id: string, dto: UpdatePlantDto) {
    await this.findPlant(tenantId, id);
    try {
      return await this.prisma.plant.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu isimde bir tesis (Plant) zaten var");
      }
      throw e;
    }
  }

  async removePlant(tenantId: string, id: string) {
    await this.findPlant(tenantId, id);
    return this.prisma.plant.delete({ where: { id } });
  }

  private async findPlant(tenantId: string, id: string) {
    const plant = await this.prisma.plant.findFirst({ where: { id, tenantId } });
    if (!plant) throw new NotFoundException("Tesis (Plant) bulunamadı");
    return plant;
  }

  // ---- Area ----
  async createArea(tenantId: string, dto: CreateAreaDto) {
    await this.findPlant(tenantId, dto.plantId);
    try {
      return await this.prisma.area.create({ data: { tenantId, plantId: dto.plantId, name: dto.name } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu isimde bir alan (Area) bu tesiste zaten var");
      }
      throw e;
    }
  }

  async updateArea(tenantId: string, id: string, dto: UpdateAreaDto) {
    await this.findArea(tenantId, id);
    try {
      return await this.prisma.area.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu isimde bir alan (Area) bu tesiste zaten var");
      }
      throw e;
    }
  }

  async removeArea(tenantId: string, id: string) {
    await this.findArea(tenantId, id);
    return this.prisma.area.delete({ where: { id } });
  }

  private async findArea(tenantId: string, id: string) {
    const area = await this.prisma.area.findFirst({ where: { id, tenantId } });
    if (!area) throw new NotFoundException("Alan (Area) bulunamadı");
    return area;
  }

  // ---- Workplace ----
  async createWorkplace(tenantId: string, dto: CreateWorkplaceDto) {
    await this.findArea(tenantId, dto.areaId);
    try {
      return await this.prisma.workplace.create({ data: { tenantId, areaId: dto.areaId, name: dto.name } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu isimde bir çalışma alanı (Workplace) bu alanda zaten var");
      }
      throw e;
    }
  }

  async updateWorkplace(tenantId: string, id: string, dto: UpdateWorkplaceDto) {
    await this.findWorkplace(tenantId, id);
    try {
      return await this.prisma.workplace.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu isimde bir çalışma alanı (Workplace) bu alanda zaten var");
      }
      throw e;
    }
  }

  async removeWorkplace(tenantId: string, id: string) {
    await this.findWorkplace(tenantId, id);
    return this.prisma.workplace.delete({ where: { id } });
  }

  private async findWorkplace(tenantId: string, id: string) {
    const workplace = await this.prisma.workplace.findFirst({ where: { id, tenantId } });
    if (!workplace) throw new NotFoundException("Çalışma alanı (Workplace) bulunamadı");
    return workplace;
  }

  // ---- Unit ----
  async createUnit(tenantId: string, dto: CreateUnitDto) {
    await this.findWorkplace(tenantId, dto.workplaceId);
    try {
      return await this.prisma.unit.create({
        data: { tenantId, workplaceId: dto.workplaceId, name: dto.name },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu isimde bir birim (Unit) bu çalışma alanında zaten var");
      }
      throw e;
    }
  }

  async updateUnit(tenantId: string, id: string, dto: UpdateUnitDto) {
    await this.findUnit(tenantId, id);
    try {
      return await this.prisma.unit.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu isimde bir birim (Unit) bu çalışma alanında zaten var");
      }
      throw e;
    }
  }

  async removeUnit(tenantId: string, id: string) {
    await this.findUnit(tenantId, id);
    return this.prisma.unit.delete({ where: { id } });
  }

  private async findUnit(tenantId: string, id: string) {
    const unit = await this.prisma.unit.findFirst({ where: { id, tenantId } });
    if (!unit) throw new NotFoundException("Birim (Unit) bulunamadı");
    return unit;
  }

  // ---- Makine ataması ----
  /** Bir makineyi bir Unit'e yerleştirir/kaldırır (unitId=null: sahadan kaldır). */
  async assignMachine(tenantId: string, machineId: string, unitId: string | null) {
    const machine = await this.prisma.machine.findFirst({ where: { id: machineId, tenantId } });
    if (!machine) throw new NotFoundException("Makine bulunamadı");
    if (unitId) await this.findUnit(tenantId, unitId);
    return this.prisma.machine.update({ where: { id: machineId }, data: { unitId } });
  }
}
