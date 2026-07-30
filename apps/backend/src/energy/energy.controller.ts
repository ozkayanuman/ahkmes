import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createEnergyReadingSchema, type CreateEnergyReadingDto } from "@ahkmes/shared-types";
import { EnergyService } from "./energy.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("energy")
@RequirePage("energy")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class EnergyController {
  constructor(private readonly service: EnergyService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("machineId") machineId?: string) {
    return this.service.findAll(user.tenantId, machineId);
  }

  @Get("summary")
  summary(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    return this.service.summary(user.tenantId, from, to);
  }

  @Post()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createEnergyReadingSchema)) dto: CreateEnergyReadingDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Delete(":id")
  @Roles("ADMIN", "PLANNER")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
