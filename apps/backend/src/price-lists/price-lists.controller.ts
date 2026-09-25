import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createPriceListSchema,
  updatePriceListSchema,
  upsertPriceListLineSchema,
  type CreatePriceListDto,
  type UpdatePriceListDto,
  type UpsertPriceListLineDto,
} from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PriceListsService } from "./price-lists.service";

@Controller("price-lists")
@RequirePage("quotes")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class PriceListsController {
  constructor(private readonly service: PriceListsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("customerId") customerId?: string) {
    return this.service.listPriceLists(user.tenantId, customerId);
  }

  @Get("resolve")
  resolve(@CurrentUser() user: AuthUser, @Query("partId") partId: string, @Query("customerId") customerId?: string) {
    return this.service.resolve(user.tenantId, partId, customerId);
  }

  @Post()
  @Roles("ADMIN", "SALES")
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createPriceListSchema)) dto: CreatePriceListDto) {
    return this.service.createPriceList(user.tenantId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "SALES")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(updatePriceListSchema)) dto: UpdatePriceListDto) {
    return this.service.updatePriceList(user.tenantId, id, dto);
  }

  @Get(":id/lines")
  listLines(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.listLines(user.tenantId, id);
  }

  @Post(":id/lines")
  @Roles("ADMIN", "SALES")
  upsertLine(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(upsertPriceListLineSchema)) dto: UpsertPriceListLineDto) {
    return this.service.upsertLine(user.tenantId, id, dto);
  }

  @Delete(":id/lines/:lineId")
  @Roles("ADMIN", "SALES")
  removeLine(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("lineId") lineId: string) {
    return this.service.removeLine(user.tenantId, id, lineId);
  }
}
