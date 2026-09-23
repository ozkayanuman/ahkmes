import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  createMachineRequiredSkillSchema,
  createSkillSchema,
  grantOperatorSkillSchema,
  type CreateMachineRequiredSkillDto,
  type CreateSkillDto,
  type GrantOperatorSkillDto,
} from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SkillsService } from "./skills.service";

@Controller("skills")
@RequirePage("machines", "users")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class SkillsController {
  constructor(private readonly service: SkillsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.listSkills(user.tenantId);
  }

  @Post()
  @Roles("ADMIN")
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createSkillSchema)) dto: CreateSkillDto) {
    return this.service.createSkill(user.tenantId, dto);
  }

  @Get("operators/:operatorId")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  listOperatorSkills(@CurrentUser() user: AuthUser, @Param("operatorId") operatorId: string) {
    return this.service.listOperatorSkills(user.tenantId, operatorId);
  }

  @Post("grants")
  @Roles("ADMIN")
  grant(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(grantOperatorSkillSchema)) dto: GrantOperatorSkillDto) {
    return this.service.grantOperatorSkill(user.tenantId, user.userId, dto);
  }

  @Post("grants/:id/revoke")
  @Roles("ADMIN")
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.revokeOperatorSkill(user.tenantId, user.userId, id);
  }
}

@Controller("machines/:machineId/required-skills")
@RequirePage("machines")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class MachineRequiredSkillsController {
  constructor(private readonly service: SkillsService) {}

  @Get()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  list(@CurrentUser() user: AuthUser, @Param("machineId") machineId: string) {
    return this.service.listMachineRequiredSkills(user.tenantId, machineId);
  }

  @Post()
  @Roles("ADMIN")
  add(
    @CurrentUser() user: AuthUser,
    @Param("machineId") machineId: string,
    @Body(new ZodValidationPipe(createMachineRequiredSkillSchema)) dto: CreateMachineRequiredSkillDto,
  ) {
    return this.service.addMachineRequiredSkill(user.tenantId, user.userId, machineId, dto);
  }

  @Delete(":requirementId")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("machineId") machineId: string, @Param("requirementId") requirementId: string) {
    return this.service.removeMachineRequiredSkill(user.tenantId, user.userId, machineId, requirementId);
  }
}
