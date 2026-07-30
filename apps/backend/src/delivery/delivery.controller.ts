import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createDeliverySchema, type CreateDeliveryDto } from "@ahkmes/shared-types";
import { DeliveryService } from "./delivery.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("deliveries")
@RequirePage("sales-orders")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("salesOrderId") salesOrderId?: string) {
    return this.service.findAll(user.tenantId, salesOrderId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDeliverySchema)) dto: CreateDeliveryDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }
}
