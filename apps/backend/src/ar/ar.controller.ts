import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createCustomerPaymentSchema, reconcilePaymentSchema, type CreateCustomerPaymentDto, type ReconcilePaymentDto } from "@ahkmes/shared-types";
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
  findPayments(@CurrentUser() user: AuthUser, @Query("customerId") customerId?: string, @Query("reconciled") reconciled?: string) {
    return this.service.findPayments(user.tenantId, customerId, reconciled === undefined ? undefined : reconciled === "true");
  }

  @Post("payments")
  @Roles("ADMIN", "SALES")
  createPayment(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCustomerPaymentSchema)) dto: CreateCustomerPaymentDto,
  ) {
    return this.service.createPayment(user.tenantId, user.userId, dto);
  }

  @Post("payments/:id/reconcile")
  @Roles("ADMIN", "SALES")
  reconcilePayment(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reconcilePaymentSchema)) dto: ReconcilePaymentDto,
  ) {
    return this.service.reconcilePayment(user.tenantId, user.userId, id, dto);
  }

  @Post("payments/:id/unreconcile")
  @Roles("ADMIN", "SALES")
  unreconcilePayment(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.unreconcilePayment(user.tenantId, id);
  }

  @Get("summary")
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.tenantId);
  }
}
