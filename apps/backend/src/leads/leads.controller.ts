import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { createLeadSchema, updateLeadSchema, type CreateLeadDto, type UpdateLeadDto } from "@ahkmes/shared-types";
import { LeadsService } from "./leads.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("leads")
@RequirePage("leads")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "SALES")
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createLeadSchema)) dto: CreateLeadDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "SALES")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateLeadSchema)) dto: UpdateLeadDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Post(":id/convert")
  @Roles("ADMIN", "SALES")
  convert(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.convert(user.tenantId, id);
  }
}
