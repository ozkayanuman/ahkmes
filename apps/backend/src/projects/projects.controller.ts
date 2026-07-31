import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createProjectSchema,
  createProjectTaskSchema,
  updateProjectSchema,
  type CreateProjectDto,
  type CreateProjectTaskDto,
  type UpdateProjectDto,
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

@Controller("projects")
@RequirePage("projects")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  // "assignable-users" route'u ":id"den ÖNCE tanımlanmalı — aksi halde NestJS
  // bu segmenti bir proje id'si sanıp @Get(":id")'e yönlendirir.
  @Get("assignable-users")
  assignableUsers(@CurrentUser() user: AuthUser) {
    return this.service.assignableUsers(user.tenantId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Get(":id/cost")
  cost(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.cost(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER")
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createProjectSchema)) dto: CreateProjectDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "PLANNER")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) dto: UpdateProjectDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Post(":id/tasks")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  createTask(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createProjectTaskSchema)) dto: CreateProjectTaskDto,
  ) {
    return this.service.createTask(user.tenantId, id, dto);
  }
}
