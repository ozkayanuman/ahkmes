import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { runFiniteScheduleSchema, type RunFiniteScheduleDto } from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SchedulingService } from "./scheduling.service";

function parseDate(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException("Geçersiz tarih");
  return parsed;
}

@Controller("scheduling")
@RequirePage("scheduling")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class SchedulingController {
  constructor(private readonly service: SchedulingService) {}

  /** MRP II finite-capacity run. `commit:false` is a what-if simulation and persists nothing. */
  @Post("runs")
  @Roles("ADMIN", "PLANNER")
  run(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(runFiniteScheduleSchema)) dto: RunFiniteScheduleDto) {
    return this.service.runFiniteSchedule(user.tenantId, user.userId, dto);
  }

  @Get("runs")
  runs(@CurrentUser() user: AuthUser) {
    return this.service.listRuns(user.tenantId);
  }

  @Get("runs/:id")
  runDetail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.getRun(user.tenantId, id);
  }

  @Get("machine-queue")
  machineQueue(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string, @Query("plantId") plantId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const defaultTo = new Date(today);
    defaultTo.setDate(defaultTo.getDate() + 13);
    const fromDate = parseDate(from, today);
    const toDate = parseDate(to, defaultTo);
    if (toDate < fromDate) throw new BadRequestException("'to' 'from'dan önce olamaz");
    return this.service.machineQueue(user.tenantId, fromDate, toDate, plantId || undefined);
  }

  @Get("capacity")
  capacity(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const defaultTo = new Date(today);
    defaultTo.setDate(defaultTo.getDate() + 13);
    const fromDate = parseDate(from, today);
    const toDate = parseDate(to, defaultTo);
    if (toDate < fromDate) throw new BadRequestException("'to' 'from'dan önce olamaz");
    return this.service.capacity(user.tenantId, fromDate, toDate);
  }

  @Get("bottlenecks")
  bottlenecks(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const defaultTo = new Date(today);
    defaultTo.setDate(defaultTo.getDate() + 13);
    const fromDate = parseDate(from, today);
    const toDate = parseDate(to, defaultTo);
    if (toDate < fromDate) throw new BadRequestException("'to' 'from'dan önce olamaz");
    return this.service.bottlenecks(user.tenantId, fromDate, toDate);
  }
}
