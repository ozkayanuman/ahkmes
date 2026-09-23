import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { createCostRateCardSchema, costingRateCardQuerySchema, updateCostRateCardSchema, type CreateCostRateCardDto, type UpdateCostRateCardDto } from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireActionPermissions } from "../common/decorators/require-action-permission.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { ActionPermissionsGuard } from "../common/guards/action-permissions.guard";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CostingService } from "./costing.service";

@Controller("costing")
@RequirePage("work-orders")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard, ActionPermissionsGuard)
export class CostingController {
  constructor(private readonly service: CostingService) {}

  @Get("rate-cards") @RequireActionPermissions("COSTING_READ")
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(costingRateCardQuerySchema)) query: { plantId?: string }) { return this.service.listRateCards(user.tenantId, query.plantId); }

  @Post("rate-cards") @RequireActionPermissions("COSTING_RATE_ADMIN")
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createCostRateCardSchema)) dto: CreateCostRateCardDto) { return this.service.createRateCard(user.tenantId, user.userId, dto); }

  @Patch("rate-cards/:id") @RequireActionPermissions("COSTING_RATE_ADMIN")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(updateCostRateCardSchema)) dto: UpdateCostRateCardDto) { return this.service.updateRateCard(user.tenantId, user.userId, id, dto); }

  @Post("rate-cards/:id/release") @RequireActionPermissions("COSTING_RATE_ADMIN")
  release(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.service.releaseRateCard(user.tenantId, user.userId, id); }

  @Get("work-orders") @RequireActionPermissions("COSTING_READ")
  workOrders(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(costingRateCardQuerySchema)) query: { plantId?: string; asOf?: Date }) { return this.service.workOrderSummaries(user.tenantId, query.plantId, query.asOf); }
}
