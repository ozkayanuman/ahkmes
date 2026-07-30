import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  convertRfqSchema,
  createRfqSchema,
  rfqLineInputSchema,
  rfqStatusUpdateSchema,
  updateRfqLineSchema,
  updateRfqSchema,
  type ConvertRfqDto,
  type CreateRfqDto,
  type RfqLineInputDto,
  type RfqStatusUpdateDto,
  type UpdateRfqDto,
  type UpdateRfqLineDto,
} from "@ahkmes/shared-types";
import type { RFQStatus } from "@prisma/client";
import { RfqService } from "./rfq.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("rfq")
@RequirePage("rfq")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class RfqController {
  constructor(private readonly service: RfqService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("status") status?: RFQStatus, @Query("q") q?: string) {
    return this.service.findAll(user.tenantId, status, q);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "SALES")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRfqSchema)) dto: CreateRfqDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "SALES")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateRfqSchema)) dto: UpdateRfqDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Patch(":id/status")
  @Roles("ADMIN", "SALES")
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rfqStatusUpdateSchema)) dto: RfqStatusUpdateDto,
  ) {
    return this.service.setStatus(user.tenantId, id, dto.status);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Post(":id/lines")
  @Roles("ADMIN", "SALES")
  addLine(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rfqLineInputSchema)) dto: RfqLineInputDto,
  ) {
    return this.service.addLine(user.tenantId, id, dto);
  }

  @Patch(":id/lines/:lineId")
  @Roles("ADMIN", "SALES")
  updateLine(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body(new ZodValidationPipe(updateRfqLineSchema)) dto: UpdateRfqLineDto,
  ) {
    return this.service.updateLine(user.tenantId, id, lineId, dto);
  }

  @Delete(":id/lines/:lineId")
  @Roles("ADMIN", "SALES")
  removeLine(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("lineId") lineId: string) {
    return this.service.removeLine(user.tenantId, id, lineId);
  }

  @Post(":id/convert")
  @Roles("ADMIN", "SALES")
  convert(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(convertRfqSchema)) dto: ConvertRfqDto,
  ) {
    return this.service.convert(user.tenantId, id, user.userId, dto);
  }
}
