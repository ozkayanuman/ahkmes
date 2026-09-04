import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { OeeService } from "./oee.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";
import { parseOeeCalculationContext } from "./oee-request";

@Controller("oee")
@UseGuards(JwtAuthGuard)
export class OeeController {
  constructor(private readonly service: OeeService) {}

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
