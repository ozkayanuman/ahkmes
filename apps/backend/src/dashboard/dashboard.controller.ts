import { Controller, Get, UseGuards } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.tenantId);
  }

  @Get("status-bar")
  statusBar(@CurrentUser() user: AuthUser) {
    return this.service.statusBar(user.tenantId);
  }
}
