import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createBinSchema,
  updateBinSchema,
  type CreateBinDto,
  type UpdateBinDto,
} from "@ahkmes/shared-types";
import { BinsService } from "./bins.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("bins")
@RequirePage("warehouses")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class BinsController {
  constructor(private readonly service: BinsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("warehouseId") warehouseId?: string) {
    return this.service.findAll(user.tenantId, warehouseId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Get(":id/balances")
  balances(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.balances(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createBinSchema)) dto: CreateBinDto,
  ) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "PLANNER")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateBinSchema)) dto: UpdateBinDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
