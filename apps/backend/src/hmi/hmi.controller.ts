import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  hmiCompleteOperationSchema,
  hmiOperationQueueQuerySchema,
  type HmiCompleteOperationDto,
  type HmiOperationQueueQueryDto,
} from "@ahkmes/shared-types";
import { ActionPermissionsService } from "../action-permissions/action-permissions.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireActionPermissions } from "../common/decorators/require-action-permission.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ActionPermissionsGuard } from "../common/guards/action-permissions.guard";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { HmiService } from "./hmi.service";

const EXECUTION_ROLES = ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"] as const;

@Controller("hmi")
@RequirePage("hmi-operations")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard, ActionPermissionsGuard)
export class HmiController {
  constructor(
    private readonly service: HmiService,
    private readonly permissions: ActionPermissionsService,
  ) {}

  @Get("actions")
  actions(@CurrentUser() user: AuthUser) {
    return this.permissions.grantedActions(user.tenantId, user.userId, user.role);
  }

  @Get("operations")
  @RequireActionPermissions("HMI_READ")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(hmiOperationQueueQuerySchema)) query: HmiOperationQueueQueryDto,
  ) {
    return this.service.list(user.tenantId, query);
  }

  @Get("operations/:id")
  @RequireActionPermissions("HMI_READ")
  detail(@CurrentUser() user: AuthUser, @Param("id") operationId: string) {
    return this.service.detail(user.tenantId, operationId);
  }

  @Post("operations/:id/start")
  @Roles(...EXECUTION_ROLES)
  @RequireActionPermissions("HMI_START")
  start(@CurrentUser() user: AuthUser, @Param("id") operationId: string) {
    return this.service.start(user.tenantId, user.userId, operationId);
  }

  @Post("operations/:id/complete")
  @Roles(...EXECUTION_ROLES)
  @RequireActionPermissions("HMI_COMPLETE")
  complete(
    @CurrentUser() user: AuthUser,
    @Param("id") operationId: string,
    @Body(new ZodValidationPipe(hmiCompleteOperationSchema)) dto: HmiCompleteOperationDto,
  ) {
    return this.service.complete(user.tenantId, user.userId, operationId, dto);
  }
}
