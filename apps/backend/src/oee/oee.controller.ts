import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { OeeService } from "./oee.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";
import { parseOeeCalculationContext } from "./oee-request";
import { ActionPermissionsGuard } from "../common/guards/action-permissions.guard";
import { RequireActionPermissions } from "../common/decorators/require-action-permission.decorator";
import { PagesGuard } from "../common/guards/pages.guard";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { OeeCockpitService } from "./oee-cockpit.service";

@Controller("oee")
@RequirePage("shift-report")
@RequireActionPermissions("OEE_READ")
@UseGuards(JwtAuthGuard, PagesGuard, ActionPermissionsGuard)
export class OeeController {
  constructor(private readonly service: OeeService, private readonly cockpit?: OeeCockpitService) {}

  @Get("cockpit")
  cockpitRead(
    @CurrentUser() user: AuthUser,
    @Query("plantId") plantId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("asOf") asOf?: string,
  ) {
    if (!this.cockpit) throw new Error("OEE cockpit service is unavailable");
    return this.cockpit.read({ tenantId: user.tenantId, ...parseOeeCalculationContext(plantId, from, to, asOf) });
  }

  @Get()
  calculate(
    @CurrentUser() user: AuthUser,
    @Query("plantId") plantId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("asOf") asOf?: string,
  ) {
    return this.service.calculate({ tenantId: user.tenantId, ...parseOeeCalculationContext(plantId, from, to, asOf) });
  }

  @Get("trend")
  trend(
    @CurrentUser() user: AuthUser,
    @Query("plantId") plantId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("asOf") asOf?: string,
  ) {
    return this.service.trend({ tenantId: user.tenantId, ...parseOeeCalculationContext(plantId, from, to, asOf) });
  }

  @Get("downtime-pareto")
  downtimePareto(
    @CurrentUser() user: AuthUser,
    @Query("plantId") plantId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("asOf") asOf?: string,
  ) {
    return this.service.downtimePareto({ tenantId: user.tenantId, ...parseOeeCalculationContext(plantId, from, to, asOf) });
  }
}
