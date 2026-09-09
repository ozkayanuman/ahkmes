import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createPlantProductionCalendarSchema, createProductionShiftSchema, type CreatePlantProductionCalendarDto, type CreateProductionShiftDto } from "@ahkmes/shared-types";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { ProductionCalendarService } from "./production-calendar.service";
@Controller("production-calendars") @RequirePage("hierarchy") @UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class ProductionCalendarController {
  constructor(private readonly service: ProductionCalendarService) {}
  @Get("plant/:plantId") list(@CurrentUser() user: AuthUser, @Param("plantId") plantId: string) { return this.service.list(user.tenantId, plantId); }
  @Get("plant/:plantId/resolve") resolve(@CurrentUser() user: AuthUser, @Param("plantId") plantId: string, @Query("at") at?: string) { return this.service.resolve(user.tenantId, plantId, at ? new Date(at) : new Date()); }
  @Post() @Roles("ADMIN", "PLANNER") create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createPlantProductionCalendarSchema)) dto: CreatePlantProductionCalendarDto) { return this.service.createCalendar(user.tenantId, user.userId, dto); }
  @Post("shifts") @Roles("ADMIN", "PLANNER") shift(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createProductionShiftSchema)) dto: CreateProductionShiftDto) { return this.service.createShift(user.tenantId, user.userId, dto); }
}
