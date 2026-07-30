import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  acknowledgeAlarmSchema,
  createAlarmDefinitionSchema,
  updateAlarmDefinitionSchema,
  type AcknowledgeAlarmDto,
  type CreateAlarmDefinitionDto,
  type UpdateAlarmDefinitionDto,
} from "@ahkmes/shared-types";
import { AlarmsService } from "./alarms.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("alarms")
@RequirePage("alarms")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class AlarmsController {
  constructor(private readonly service: AlarmsService) {}

  @Get("definitions")
  findDefinitions(@CurrentUser() user: AuthUser, @Query("machineId") machineId?: string) {
    return this.service.findDefinitions(user.tenantId, machineId);
  }

  @Post("definitions")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  createDefinition(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createAlarmDefinitionSchema)) dto: CreateAlarmDefinitionDto,
  ) {
    return this.service.createDefinition(user.tenantId, dto);
  }

  @Patch("definitions/:id")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  updateDefinition(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAlarmDefinitionSchema)) dto: UpdateAlarmDefinitionDto,
  ) {
    return this.service.updateDefinition(user.tenantId, id, dto);
  }

  @Delete("definitions/:id")
  @Roles("ADMIN")
  removeDefinition(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.removeDefinition(user.tenantId, id);
  }

  @Get("active")
  active(@CurrentUser() user: AuthUser) {
    return this.service.active(user.tenantId);
  }

  @Get("pareto")
  pareto(
    @CurrentUser() user: AuthUser,
    @Query("machineId") machineId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.service.pareto(user.tenantId, machineId, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  @Post(":eventId/acknowledge")
  @Roles("ADMIN", "PLANNER", "FOREMAN", "OPERATOR")
  acknowledge(
    @CurrentUser() user: AuthUser,
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(acknowledgeAlarmSchema)) dto: AcknowledgeAlarmDto,
  ) {
    return this.service.acknowledge(user.tenantId, eventId, user.userId, dto.note);
  }
}
