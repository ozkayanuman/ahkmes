import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  completeMaintenanceOrderSchema,
  createMaintenanceOrderSchema,
  type CompleteMaintenanceOrderDto,
  type CreateMaintenanceOrderDto,
} from "@ahkmes/shared-types";
import type { MaintenanceOrderStatus } from "@prisma/client";
import { MaintenanceOrdersService } from "./maintenance-orders.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("maintenance-orders")
@RequirePage("maintenance-orders")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class MaintenanceOrdersController {
  constructor(private readonly service: MaintenanceOrdersService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query("machineId") machineId?: string,
    @Query("status") status?: MaintenanceOrderStatus,
  ) {
    return this.service.findAll(user.tenantId, machineId, status);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createMaintenanceOrderSchema)) dto: CreateMaintenanceOrderDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Post("predictive-check")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  predictiveCheck(@CurrentUser() user: AuthUser) {
    return this.service.predictiveCheck(user.tenantId, user.userId);
  }

  @Patch(":id/start")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  start(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.setStatus(user.tenantId, id, "IN_PROGRESS");
  }

  @Patch(":id/cancel")
  @Roles("ADMIN", "PLANNER")
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.setStatus(user.tenantId, id, "CANCELLED");
  }

  @Patch(":id/complete")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  complete(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(completeMaintenanceOrderSchema)) dto: CompleteMaintenanceOrderDto,
  ) {
    return this.service.complete(user.tenantId, id, dto);
  }
}
