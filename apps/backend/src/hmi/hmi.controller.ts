import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  hmiCompleteOperationSchema,
  hmiLifecycleCommandSchema,
  hmiProductionReportSchema,
  hmiReworkStartSchema,
  hmiReworkReportSchema,
  hmiOperationQueueQuerySchema,
  createMaintenanceRequestSchema,
  declareMaintenanceBreakdownSchema,
  type CreateMaintenanceRequestDto,
  type DeclareMaintenanceBreakdownDto,
  type HmiCompleteOperationDto,
  type HmiOperationQueueQueryDto,
} from "@ahkmes/shared-types";
import { ActionPermissionsService } from "../action-permissions/action-permissions.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireActionPermissions } from "../common/decorators/require-action-permission.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { RequireProductModule } from "../common/decorators/require-product-module.decorator";
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
    return this.service.completeLifecycle(user.tenantId, user.userId, operationId, dto);
  }

  @Post("operations/:id/setup/start") @Roles(...EXECUTION_ROLES) @RequireActionPermissions("HMI_SETUP")
  setupStart(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(hmiLifecycleCommandSchema)) dto: any) { return this.service.setupStart(user.tenantId, user.userId, id, dto); }
  @Post("operations/:id/setup/complete") @Roles(...EXECUTION_ROLES) @RequireActionPermissions("HMI_SETUP")
  setupComplete(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(hmiLifecycleCommandSchema)) dto: any) { return this.service.setupComplete(user.tenantId, user.userId, id, dto); }
  @Post("operations/:id/pause") @Roles(...EXECUTION_ROLES) @RequireActionPermissions("HMI_PAUSE")
  pause(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(hmiLifecycleCommandSchema)) dto: any) { return this.service.pause(user.tenantId, user.userId, id, dto); }
  @Post("operations/:id/resume") @Roles(...EXECUTION_ROLES) @RequireActionPermissions("HMI_RESUME")
  resume(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(hmiLifecycleCommandSchema)) dto: any) { return this.service.resume(user.tenantId, user.userId, id, dto); }
  @Post("operations/:id/hold") @Roles("ADMIN", "PLANNER", "FOREMAN") @RequireActionPermissions("HMI_HOLD")
  hold(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(hmiLifecycleCommandSchema)) dto: any) { return this.service.hold(user.tenantId, user.userId, id, dto); }
  @Post("operations/:id/hold/release") @Roles("ADMIN", "PLANNER", "FOREMAN") @RequireActionPermissions("HMI_HOLD_RELEASE")
  releaseHold(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(hmiLifecycleCommandSchema)) dto: any) { return this.service.releaseHold(user.tenantId, user.userId, id, dto); }
  @Post("operations/:id/reports") @Roles(...EXECUTION_ROLES) @RequireActionPermissions("HMI_REPORT")
  report(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(hmiProductionReportSchema)) dto: any) { return this.service.report(user.tenantId, user.userId, id, dto); }
  @Post("operations/:id/rework/start") @Roles("ADMIN", "PLANNER", "FOREMAN") @RequireActionPermissions("HMI_REWORK")
  startRework(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(hmiReworkStartSchema)) dto: any) { return this.service.startRework(user.tenantId, user.userId, id, dto); }
  @Post("operations/:id/rework/report") @Roles("ADMIN", "PLANNER", "FOREMAN") @RequireActionPermissions("HMI_REWORK")
  reportRework(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(hmiReworkReportSchema)) dto: any) { return this.service.reportRework(user.tenantId, user.userId, id, dto); }

  @Post("maintenance/requests")
  @Roles(...EXECUTION_ROLES)
  @RequireProductModule("EAM_MAINTENANCE")
  @RequireActionPermissions("CMMS_REQUEST_CREATE")
  createMaintenanceRequest(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createMaintenanceRequestSchema)) dto: CreateMaintenanceRequestDto) {
    return this.service.createMaintenanceRequest(user.tenantId, user.userId, dto);
  }

  @Post("maintenance/breakdowns")
  @Roles(...EXECUTION_ROLES)
  @RequireProductModule("EAM_MAINTENANCE")
  @RequireActionPermissions("CMMS_BREAKDOWN_DECLARE")
  declareMaintenanceBreakdown(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(declareMaintenanceBreakdownSchema)) dto: DeclareMaintenanceBreakdownDto) {
    return this.service.declareMaintenanceBreakdown(user.tenantId, user.userId, dto);
  }
}
