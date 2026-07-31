import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateProjectDto,
  CreateProjectTaskDto,
  CreateProjectTimeEntryDto,
  UpdateProjectDto,
  UpdateProjectTaskDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.project.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  }

  /**
   * Görev atama dropdown'u için dar bir kullanıcı listesi — UsersService.findAll()
   * (@Roles("ADMIN") + hourlyRate/department gibi hassas HR alanları döndürür)
   * PLANNER/FOREMAN'a açılamaz; bu yüzden burada sadece id/name ile ayrı,
   * minimal bir endpoint tanımlandı (bkz. Faz G "cross-page API erişimi" dersi).
   */
  assignableUsers(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, tenantId },
      include: {
        tasks: {
          orderBy: { createdAt: "asc" },
          include: {
            assignee: { select: { id: true, name: true } },
            timeEntries: { select: { id: true, hours: true, date: true, userId: true } },
          },
        },
      },
    });
    if (!project) throw new NotFoundException("Proje bulunamadı");
    return project;
  }

  async create(tenantId: string, dto: CreateProjectDto) {
    try {
      return await this.prisma.project.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu proje kodu zaten kayıtlı");
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateProjectDto) {
    await this.findProjectOrThrow(tenantId, id);
    return this.prisma.project.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    await this.findProjectOrThrow(tenantId, id);
    try {
      return await this.prisma.project.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException("Projeye bağlı görevler var, silinemez");
      }
      throw e;
    }
  }

  /**
   * Labor Tracking'in (Faz H) ProjectTask eşdeğeri: her görevin zaman
   * girişleri User.hourlyRate ile çarpılır. work-orders.service.ts cost()
   * ile aynı "partial" deseni — hourlyRate eksikse sessizce atlanmaz,
   * kullanıcıya görünür bir uyarı döner.
   */
  async cost(tenantId: string, id: string) {
    await this.findProjectOrThrow(tenantId, id);

    const entries = await this.prisma.projectTimeEntry.findMany({
      where: { tenantId, task: { projectId: id } },
      include: { user: { select: { id: true, name: true, hourlyRate: true } } },
    });

    let laborCost = 0;
    let laborCostPartial = false;
    for (const e of entries) {
      if (e.user.hourlyRate === null) {
        laborCostPartial = true;
        continue;
      }
      laborCost += Number(e.hours) * Number(e.user.hourlyRate);
    }

    return {
      projectId: id,
      laborCost,
      laborCostPartial,
      totalCost: laborCost,
      note: laborCostPartial
        ? "Bazı zaman girişlerinde kullanıcının işçilik oranı (hourlyRate) girilmediği için toplam maliyet eksiktir."
        : undefined,
    };
  }

  private async findProjectOrThrow(tenantId: string, id: string) {
    const project = await this.prisma.project.findFirst({ where: { id, tenantId } });
    if (!project) throw new NotFoundException("Proje bulunamadı");
    return project;
  }

  // ---- ProjectTask (WBS) ----

  async createTask(tenantId: string, projectId: string, dto: CreateProjectTaskDto) {
    await this.findProjectOrThrow(tenantId, projectId);
    if (dto.parentTaskId) {
      const parent = await this.prisma.projectTask.findFirst({
        where: { id: dto.parentTaskId, tenantId, projectId },
      });
      if (!parent) throw new NotFoundException("Üst görev bulunamadı");
    }
    if (dto.assigneeId) {
      const assignee = await this.prisma.user.findFirst({ where: { id: dto.assigneeId, tenantId } });
      if (!assignee) throw new NotFoundException("Atanan kullanıcı bulunamadı");
    }
    return this.prisma.projectTask.create({ data: { ...dto, projectId, tenantId } });
  }

  async updateTask(tenantId: string, taskId: string, dto: UpdateProjectTaskDto) {
    const task = await this.findTaskOrThrow(tenantId, taskId);
    if (dto.assigneeId) {
      const assignee = await this.prisma.user.findFirst({ where: { id: dto.assigneeId, tenantId } });
      if (!assignee) throw new NotFoundException("Atanan kullanıcı bulunamadı");
    }
    return this.prisma.projectTask.update({ where: { id: task.id }, data: dto });
  }

  async removeTask(tenantId: string, taskId: string) {
    const task = await this.findTaskOrThrow(tenantId, taskId);
    try {
      return await this.prisma.projectTask.delete({ where: { id: task.id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException("Göreve bağlı alt görev veya zaman kaydı var, silinemez");
      }
      throw e;
    }
  }

  private async findTaskOrThrow(tenantId: string, id: string) {
    const task = await this.prisma.projectTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException("Görev bulunamadı");
    return task;
  }

  // ---- ProjectTimeEntry ----

  async addTimeEntry(tenantId: string, taskId: string, userId: string, dto: CreateProjectTimeEntryDto) {
    await this.findTaskOrThrow(tenantId, taskId);
    return this.prisma.projectTimeEntry.create({ data: { ...dto, taskId, userId, tenantId } });
  }
}
