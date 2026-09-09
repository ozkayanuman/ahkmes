import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { createCycleCountSchema, type CreateCycleCountDto } from "@ahkmes/shared-types";
import { CycleCountsService } from "./cycle-counts.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { SkipAudit } from "../common/decorators/skip-audit.decorator";

@Controller("cycle-counts")
@RequirePage("cycle-counts")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class CycleCountsController {
  constructor(private readonly service: CycleCountsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("binId") binId?: string) {
    return this.service.findAll(user.tenantId, binId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  @SkipAudit()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCycleCountSchema)) dto: CreateCycleCountDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Patch(":id/post")
  @Roles("ADMIN", "PLANNER")
  @SkipAudit()
  post(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.post(user.tenantId, user.userId, id);
  }
}
