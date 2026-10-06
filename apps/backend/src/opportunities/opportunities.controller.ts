import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createOpportunitySchema,
  createOpportunityActivitySchema,
  type CreateOpportunityActivityDto,
  updateOpportunitySchema,
  type CreateOpportunityDto,
  type UpdateOpportunityDto,
} from "@ahkmes/shared-types";
import { OpportunitiesService } from "./opportunities.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

/** customers.tsx'e gömülü panel — ayrı bir NAV sayfası yok, "customers" sayfa
 * iznini kullanır (bkz. Faz G "cross-page API erişimi" dersi: burada hassas
 * alan olmadığından mevcut sayfa iznini genişletmek Proje modülündeki
 * assignable-users deseninden farklı olarak sorun oluşturmuyor). */
@Controller("opportunities")
@RequirePage("customers")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class OpportunitiesController {
  constructor(private readonly service: OpportunitiesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("customerId") customerId?: string) {
    return this.service.findAll(user.tenantId, customerId);
  }

  @Get("pipeline-summary")
  pipelineSummary(@CurrentUser() user: AuthUser) {
    return this.service.pipelineSummary(user.tenantId);
  }

  @Get(":id/activities")
  listActivities(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.listActivities(user.tenantId, id);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "SALES")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createOpportunitySchema)) dto: CreateOpportunityDto,
  ) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "SALES")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateOpportunitySchema)) dto: UpdateOpportunityDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Post(":id/activities")
  @Roles("ADMIN", "SALES")
  createActivity(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createOpportunityActivitySchema)) dto: CreateOpportunityActivityDto,
  ) {
    return this.service.createActivity(user.tenantId, id, user.userId, dto);
  }

  @Delete(":id")
  @Roles("ADMIN", "SALES")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
