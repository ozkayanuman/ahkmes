import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createInspectionSchema, type CreateInspectionDto } from "@ahkmes/shared-types";
import { InspectionsService } from "./inspections.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { SkipAudit } from "../common/decorators/skip-audit.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("inspections")
@RequirePage("inspections")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class InspectionsController {
  constructor(private readonly service: InspectionsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("workOrderId") workOrderId?: string) {
    return this.service.findAll(user.tenantId, workOrderId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @SkipAudit()
  @Roles("ADMIN", "PLANNER", "FOREMAN", "OPERATOR")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createInspectionSchema)) dto: CreateInspectionDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }
}
