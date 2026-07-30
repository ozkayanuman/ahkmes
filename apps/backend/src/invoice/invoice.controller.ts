import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { createInvoiceSchema, type CreateInvoiceDto } from "@ahkmes/shared-types";
import { InvoiceService } from "./invoice.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("invoices")
@RequirePage("sales-orders")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class InvoiceController {
  constructor(private readonly service: InvoiceService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("salesOrderId") salesOrderId?: string) {
    return this.service.findAll(user.tenantId, salesOrderId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "SALES")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createInvoiceSchema)) dto: CreateInvoiceDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Patch(":id/cancel")
  @Roles("ADMIN", "SALES")
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.cancel(user.tenantId, id);
  }
}
