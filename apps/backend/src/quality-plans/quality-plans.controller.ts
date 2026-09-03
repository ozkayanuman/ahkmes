import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createQualityPlanRevisionSchema, createQualityPlanSchema, engineeringStatusChangeSchema, type CreateQualityPlanDto, type CreateQualityPlanRevisionDto, type EngineeringStatusChangeDto } from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { SkipAudit } from "../common/decorators/skip-audit.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { QualityPlansService } from "./quality-plans.service";

@Controller("quality-plans")
@RequirePage("inspections")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class QualityPlansController {
  constructor(private readonly service: QualityPlansService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  @Post()
  @SkipAudit()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createQualityPlanSchema)) dto: CreateQualityPlanDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Post(":id/revisions")
  @SkipAudit()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  createRevision(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createQualityPlanRevisionSchema)) dto: CreateQualityPlanRevisionDto,
  ) {
    return this.service.createRevision(user.tenantId, user.userId, id, dto);
  }

  @Post(":id/status") @Roles("ADMIN", "PLANNER", "FOREMAN")
  setStatus(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(engineeringStatusChangeSchema)) dto: EngineeringStatusChangeDto) {
    if (dto.status !== "RELEASED" && dto.status !== "OBSOLETE") throw new Error("Invalid quality plan lifecycle status");
    return this.service.setStatus(user.tenantId, user.userId, id, dto.status);
  }
}
