import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  createPurchaseOrderSchema,
  purchaseOrderStatusUpdateSchema,
  receivePurchaseOrderSchema,
  updatePurchaseOrderSchema,
  type CreatePurchaseOrderDto,
  type PurchaseOrderStatusUpdateDto,
  type ReceivePurchaseOrderDto,
  type UpdatePurchaseOrderDto,
} from "@ahkmes/shared-types";
import type { PurchaseOrderStatus } from "@prisma/client";
import { PurchasingService } from "./purchasing.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("purchase-orders")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchasingController {
  constructor(private readonly service: PurchasingService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: PurchaseOrderStatus,
    @Query("q") q?: string,
  ) {
    return this.service.findAll(user.tenantId, status, q);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPurchaseOrderSchema)) dto: CreatePurchaseOrderDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "PLANNER")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderSchema)) dto: UpdatePurchaseOrderDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Patch(":id/status")
  @Roles("ADMIN", "PLANNER")
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(purchaseOrderStatusUpdateSchema)) dto: PurchaseOrderStatusUpdateDto,
  ) {
    return this.service.setStatus(user.tenantId, id, dto.status);
  }

  @Post(":id/receive")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  receive(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(receivePurchaseOrderSchema)) dto: ReceivePurchaseOrderDto,
  ) {
    return this.service.receive(user.tenantId, id, dto);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
