import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  classifyDowntimeSchema,
  createDowntimeReasonSchema,
  endDowntimeSchema,
  startDowntimeSchema,
  updateDowntimeReasonSchema,
  type ClassifyDowntimeDto,
  type CreateDowntimeReasonDto,
  type EndDowntimeDto,
  type StartDowntimeDto,
  type UpdateDowntimeReasonDto,
} from "@ahkmes/shared-types";
import { DowntimeService } from "./downtime.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { ActionPermissionsGuard } from "../common/guards/action-permissions.guard";
import { RequireActionPermissions } from "../common/decorators/require-action-permission.decorator";

/** "alarms" sayfa entitlement'ı yeniden kullanılır — Downtime/Andon, mevcut
 * Alarm Management ile aynı canonical modül (QMS_INSPECTION) altında, kendi
 * page-key/catalog genişletmesi gerektirmez (bkz. product-catalog.ts). */
@Controller("downtime")
@RequirePage("alarms")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard, ActionPermissionsGuard)
export class DowntimeController {
  constructor(private readonly service: DowntimeService) {}

  @Get("reasons")
  @RequirePage("alarms", "hmi-operations")
  findReasons(@CurrentUser() user: AuthUser) {
    return this.service.findReasons(user.tenantId);
  }

  @Get("pareto")
  pareto(@CurrentUser() user: AuthUser, @Query("days") days?: string) {
    return this.service.pareto(user.tenantId, days ? parseInt(days, 10) : 30);
  }

  @Post("reasons")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  @RequireActionPermissions("OEE_LOSS_REASON_ADMIN")
  createReason(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDowntimeReasonSchema)) dto: CreateDowntimeReasonDto,
  ) {
    return this.service.createReason(user.tenantId, dto);
  }

  @Patch("reasons/:id")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  @RequireActionPermissions("OEE_LOSS_REASON_ADMIN")
  updateReason(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDowntimeReasonSchema)) dto: UpdateDowntimeReasonDto,
  ) {
    return this.service.updateReason(user.tenantId, id, dto);
  }

  @Get()
  @RequirePage("alarms", "hmi-operations")
  list(
    @CurrentUser() user: AuthUser,
    @Query("machineId") machineId?: string,
    @Query("open") open?: string,
  ) {
    return this.service.list(user.tenantId, machineId, open === undefined ? undefined : open === "true");
  }

  @Post("start")
  @Roles("ADMIN", "PLANNER", "FOREMAN", "OPERATOR")
  @RequirePage("alarms", "hmi-operations")
  start(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(startDowntimeSchema)) dto: StartDowntimeDto,
  ) {
    return this.service.start(user.tenantId, dto.machineId, {
      reasonId: dto.reasonId,
      note: dto.note,
      source: "MANUAL",
      triggeredById: user.userId,
    });
  }

  @Patch(":id/classify")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  classify(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(classifyDowntimeSchema)) dto: ClassifyDowntimeDto,
  ) {
    return this.service.classify(user.tenantId, id, dto);
  }

  @Patch(":id/end")
  @Roles("ADMIN", "PLANNER", "FOREMAN", "OPERATOR")
  @RequirePage("alarms", "hmi-operations")
  end(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(endDowntimeSchema)) dto: EndDowntimeDto,
  ) {
    return this.service.end(user.tenantId, id, user.userId, dto);
  }
}
