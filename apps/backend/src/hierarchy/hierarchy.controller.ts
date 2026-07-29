import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  createAreaSchema,
  createPlantSchema,
  createUnitSchema,
  createWorkplaceSchema,
  updateAreaSchema,
  updatePlantSchema,
  updateUnitSchema,
  updateWorkplaceSchema,
  type CreateAreaDto,
  type CreatePlantDto,
  type CreateUnitDto,
  type CreateWorkplaceDto,
  type UpdateAreaDto,
  type UpdatePlantDto,
  type UpdateUnitDto,
  type UpdateWorkplaceDto,
} from "@ahkmes/shared-types";
import { HierarchyService } from "./hierarchy.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

const assignMachineSchema = z.object({ unitId: z.string().uuid().nullable() });
type AssignMachineDto = z.infer<typeof assignMachineSchema>;

const WRITE_ROLES = ["ADMIN", "PLANNER"] as const;

@Controller("hierarchy")
@RequirePage("hierarchy")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class HierarchyController {
  constructor(private readonly service: HierarchyService) {}

  @Get("tree")
  tree(@CurrentUser() user: AuthUser) {
    return this.service.tree(user.tenantId);
  }

  @Post("plants")
  @Roles(...WRITE_ROLES)
  createPlant(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createPlantSchema)) dto: CreatePlantDto) {
    return this.service.createPlant(user.tenantId, dto);
  }

  @Patch("plants/:id")
  @Roles(...WRITE_ROLES)
  updatePlant(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePlantSchema)) dto: UpdatePlantDto,
  ) {
    return this.service.updatePlant(user.tenantId, id, dto);
  }

  @Delete("plants/:id")
  @Roles("ADMIN")
  removePlant(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.removePlant(user.tenantId, id);
  }

  @Post("areas")
  @Roles(...WRITE_ROLES)
  createArea(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createAreaSchema)) dto: CreateAreaDto) {
    return this.service.createArea(user.tenantId, dto);
  }

  @Patch("areas/:id")
  @Roles(...WRITE_ROLES)
  updateArea(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAreaSchema)) dto: UpdateAreaDto,
  ) {
    return this.service.updateArea(user.tenantId, id, dto);
  }

  @Delete("areas/:id")
  @Roles("ADMIN")
  removeArea(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.removeArea(user.tenantId, id);
  }

  @Post("workplaces")
  @Roles(...WRITE_ROLES)
  createWorkplace(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWorkplaceSchema)) dto: CreateWorkplaceDto,
  ) {
    return this.service.createWorkplace(user.tenantId, dto);
  }

  @Patch("workplaces/:id")
  @Roles(...WRITE_ROLES)
  updateWorkplace(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWorkplaceSchema)) dto: UpdateWorkplaceDto,
  ) {
    return this.service.updateWorkplace(user.tenantId, id, dto);
  }

  @Delete("workplaces/:id")
  @Roles("ADMIN")
  removeWorkplace(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.removeWorkplace(user.tenantId, id);
  }

  @Post("units")
  @Roles(...WRITE_ROLES)
  createUnit(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createUnitSchema)) dto: CreateUnitDto) {
    return this.service.createUnit(user.tenantId, dto);
  }

  @Patch("units/:id")
  @Roles(...WRITE_ROLES)
  updateUnit(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateUnitSchema)) dto: UpdateUnitDto,
  ) {
    return this.service.updateUnit(user.tenantId, id, dto);
  }

  @Delete("units/:id")
  @Roles("ADMIN")
  removeUnit(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.removeUnit(user.tenantId, id);
  }

  @Patch("machines/:id/unit")
  @Roles(...WRITE_ROLES)
  assignMachine(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(assignMachineSchema)) dto: AssignMachineDto,
  ) {
    return this.service.assignMachine(user.tenantId, id, dto.unitId);
  }
}
