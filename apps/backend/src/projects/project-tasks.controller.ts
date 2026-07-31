import { Body, Controller, Delete, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createProjectTimeEntrySchema,
  updateProjectTaskSchema,
  type CreateProjectTimeEntryDto,
  type UpdateProjectTaskDto,
} from "@ahkmes/shared-types";
import { ProjectsService } from "./projects.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

/**
 * ProjectsController'dan (path: "projects") ayrı bir controller — /projects/:id
 * ile /projects/tasks/:id aynı derinlikte (tek segment) ve aynı HTTP metoduyla
 * (DELETE/PATCH) çakışır, NestJS route sırasına bağımlı kırılgan bir çözüm
 * yerine tamamen ayrı bir base path ("project-tasks") kullanıldı.
 */
@Controller("project-tasks")
@RequirePage("projects")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class ProjectTasksController {
  constructor(private readonly service: ProjectsService) {}

  @Patch(":id")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProjectTaskSchema)) dto: UpdateProjectTaskDto,
  ) {
    return this.service.updateTask(user.tenantId, id, dto);
  }

  @Delete(":id")
  @Roles("ADMIN", "PLANNER")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.removeTask(user.tenantId, id);
  }

  @Post(":id/time-entries")
  @Roles("ADMIN", "PLANNER", "FOREMAN", "OPERATOR")
  addTimeEntry(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createProjectTimeEntrySchema)) dto: CreateProjectTimeEntryDto,
  ) {
    return this.service.addTimeEntry(user.tenantId, id, user.userId, dto);
  }
}
