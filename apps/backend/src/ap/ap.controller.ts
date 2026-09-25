import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  createSupplierInvoiceSchema,
  createSupplierPaymentSchema,
  reconcilePaymentSchema,
  type CreateSupplierInvoiceDto,
  type CreateSupplierPaymentDto,
  type ReconcilePaymentDto,
} from "@ahkmes/shared-types";
import { ApService } from "./ap.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("ap")
@RequirePage("ap")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class ApController {
  constructor(private readonly service: ApService) {}

  @Get("invoices")
  findInvoices(@CurrentUser() user: AuthUser, @Query("purchaseOrderId") purchaseOrderId?: string) {
    return this.service.findInvoices(user.tenantId, purchaseOrderId);
  }

  @Get("invoices/:id")
  findInvoice(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findInvoice(user.tenantId, id);
  }

  @Post("invoices")
  @Roles("ADMIN", "PLANNER")
  createInvoice(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSupplierInvoiceSchema)) dto: CreateSupplierInvoiceDto,
  ) {
    return this.service.createInvoice(user.tenantId, user.userId, dto);
  }

  @Post("invoices/:id/cancel")
  @Roles("ADMIN", "PLANNER")
  cancelInvoice(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.cancelInvoice(user.tenantId, id);
  }

  @Get("payments")
  findPayments(@CurrentUser() user: AuthUser, @Query("supplierId") supplierId?: string, @Query("reconciled") reconciled?: string) {
    return this.service.findPayments(user.tenantId, supplierId, reconciled === undefined ? undefined : reconciled === "true");
  }

  @Post("payments")
  @Roles("ADMIN", "PLANNER")
  createPayment(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSupplierPaymentSchema)) dto: CreateSupplierPaymentDto,
  ) {
    return this.service.createPayment(user.tenantId, user.userId, dto);
  }

  @Post("payments/:id/reconcile")
  @Roles("ADMIN", "PLANNER")
  reconcilePayment(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reconcilePaymentSchema)) dto: ReconcilePaymentDto,
  ) {
    return this.service.reconcilePayment(user.tenantId, user.userId, id, dto);
  }

  @Post("payments/:id/unreconcile")
  @Roles("ADMIN", "PLANNER")
  unreconcilePayment(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.unreconcilePayment(user.tenantId, id);
  }

  @Get("summary")
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.tenantId);
  }
}
