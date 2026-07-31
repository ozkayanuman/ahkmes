import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createSerialNumberSchema, type CreateSerialNumberDto } from "@ahkmes/shared-types";
import { SerialNumbersService } from "./serial-numbers.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("serial-numbers")
@RequirePage("serial-numbers")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class SerialNumbersController {
  constructor(private readonly service: SerialNumbersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("partId") partId?: string) {
    return this.service.findAll(user.tenantId, partId);
  }

  // "scan/:serialNo" route'u ":id"den ÖNCE tanımlanmalı — aksi halde NestJS
  // "scan" segmentini bir seri numarası id'si sanıp @Get(":id")'e yönlendirir.
  @Get("scan/:serialNo")
  scanByCode(@CurrentUser() user: AuthUser, @Param("serialNo") serialNo: string) {
    return this.service.scanByCode(user.tenantId, serialNo);
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
    @Body(new ZodValidationPipe(createSerialNumberSchema)) dto: CreateSerialNumberDto,
  ) {
    return this.service.create(user.tenantId, dto);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
