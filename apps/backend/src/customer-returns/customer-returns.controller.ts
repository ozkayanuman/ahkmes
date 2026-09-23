import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { cancelCustomerReturnSchema, createCustomerReturnSchema, receiveCustomerReturnSchema, type CancelCustomerReturnDto, type CreateCustomerReturnDto, type ReceiveCustomerReturnDto } from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { SkipAudit } from "../common/decorators/skip-audit.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CustomerReturnsService } from "./customer-returns.service";

@Controller("customer-returns")
@RequirePage("sales-orders")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class CustomerReturnsController {
  constructor(private readonly service: CustomerReturnsService) {}
  @Get() findAll(@CurrentUser() user: AuthUser, @Query("deliveryId") deliveryId?: string, @Query("salesOrderId") salesOrderId?: string) { return this.service.findAll(user.tenantId, { deliveryId, salesOrderId }); }
  @Post() @Roles("ADMIN", "PLANNER", "FOREMAN") @SkipAudit()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createCustomerReturnSchema)) dto: CreateCustomerReturnDto) { return this.service.create(user.tenantId, user.userId, dto); }
  @Post(":id/receive") @Roles("ADMIN", "PLANNER", "FOREMAN") @SkipAudit()
  receive(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(receiveCustomerReturnSchema)) dto: ReceiveCustomerReturnDto) { return this.service.receive(user.tenantId, user.userId, id, dto); }
  @Post(":id/cancel") @Roles("ADMIN", "PLANNER", "FOREMAN") @SkipAudit()
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(cancelCustomerReturnSchema)) dto: CancelCustomerReturnDto) { return this.service.cancel(user.tenantId, user.userId, id, dto); }
}
