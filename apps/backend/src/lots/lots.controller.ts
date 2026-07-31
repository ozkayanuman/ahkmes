import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createLotSchema, type CreateLotDto } from "@ahkmes/shared-types";
import type { StockItemType } from "@prisma/client";
import { LotsService } from "./lots.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("lots")
@RequirePage("lots")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class LotsController {
  constructor(private readonly service: LotsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query("itemType") itemType?: StockItemType,
    @Query("itemId") itemId?: string,
  ) {
    return this.service.findAll(user.tenantId, itemType, itemId);
  }

  // "scan/:lotNo" route'u ":id"den ÖNCE tanımlanmalı — aksi halde NestJS
  // "scan" segmentini bir lot id'si sanıp @Get(":id")'e yönlendirir.
  @Get("scan/:lotNo")
  scanByCode(@CurrentUser() user: AuthUser, @Param("lotNo") lotNo: string) {
    return this.service.scanByCode(user.tenantId, lotNo);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Get(":id/trace")
  trace(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.trace(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createLotSchema)) dto: CreateLotDto,
  ) {
    return this.service.create(user.tenantId, dto);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
