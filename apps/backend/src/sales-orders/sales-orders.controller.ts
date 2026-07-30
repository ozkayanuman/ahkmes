import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  releaseSalesOrderSchema,
  salesOrderStatusUpdateSchema,
  type ReleaseSalesOrderDto,
  type SalesOrderStatusUpdateDto,
} from "@ahkmes/shared-types";
import type { SalesOrderStatus } from "@prisma/client";
import { SalesOrdersService } from "./sales-orders.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("sales-orders")
@RequirePage("sales-orders")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class SalesOrdersController {
  constructor(private readonly service: SalesOrdersService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: SalesOrderStatus,
    @Query("q") q?: string,
  ) {
    return this.service.findAll(user.tenantId, status, q);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Patch(":id/status")
  @Roles("ADMIN", "SALES", "PLANNER")
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(salesOrderStatusUpdateSchema)) dto: SalesOrderStatusUpdateDto,
  ) {
    return this.service.setStatus(user.tenantId, id, dto.status);
  }

  @Post(":id/release")
  @Roles("ADMIN", "PLANNER")
  release(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(releaseSalesOrderSchema)) dto: ReleaseSalesOrderDto,
  ) {
    return this.service.release(user.tenantId, id, dto);
  }
}
