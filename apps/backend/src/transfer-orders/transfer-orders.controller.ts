import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createTransferOrderSchema, type CreateTransferOrderDto } from "@ahkmes/shared-types";
import { TransferOrdersService } from "./transfer-orders.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("transfer-orders")
@RequirePage("transfer-orders")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class TransferOrdersController {
  constructor(private readonly service: TransferOrdersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("binId") binId?: string) {
    return this.service.findAll(user.tenantId, binId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTransferOrderSchema)) dto: CreateTransferOrderDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }
}
