import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditLogService } from "./audit-log.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

@Controller("audit-log")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("entity") entity?: string,
    @Query("entityId") entityId?: string,
    @Query("userId") userId?: string,
  ) {
    return this.service.list(user.tenantId, { entity, entityId, userId });
  }

  @Get("entities")
  entities(@CurrentUser() user: AuthUser) {
    return this.service.entities(user.tenantId);
  }
}
