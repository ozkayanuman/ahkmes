import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { createCustomerPaymentSchema, type CreateCustomerPaymentDto } from "@ahkmes/shared-types";
import { ArService } from "./ar.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("ar")
@RequirePage("ar")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class ArController {
  constructor(private readonly service: ArService) {}

  @Get("payments")
  findPayments(@CurrentUser() user: AuthUser, @Query("customerId") customerId?: string) {
    return this.service.findPayments(user.tenantId, customerId);
  }

  @Post("payments")
  @Roles("ADMIN", "SALES")
  createPayment(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCustomerPaymentSchema)) dto: CreateCustomerPaymentDto,
  ) {
    return this.service.createPayment(user.tenantId, user.userId, dto);
  }

  @Get("summary")
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.tenantId);
  }
}
