import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import {
  createFinishedGoodsSchema,
  type CreateFinishedGoodsDto,
} from "@ahkmes/shared-types";
import { FinishedGoodsService } from "./finished-goods.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("finished-goods")
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinishedGoodsController {
  constructor(private readonly service: FinishedGoodsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("workOrderId") workOrderId?: string) {
    return this.service.findAll(user.tenantId, workOrderId);
  }

  @Get("stocks")
  stocks(@CurrentUser() user: AuthUser) {
    return this.service.stocks(user.tenantId);
  }

  @Post()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createFinishedGoodsSchema)) dto: CreateFinishedGoodsDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }
}
