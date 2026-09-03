import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { createMrpIndependentDemandSchema, mrpPlanningParameterSchema, mrpProposalDecisionSchema, runDailyMrpSchema, type CreateMrpIndependentDemandDto, type MrpPlanningParameterDto, type MrpProposalDecisionDto, type RunDailyMrpDto } from "@ahkmes/shared-types";
import { MrpService } from "./mrp.service";
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

@Controller("mrp")
@RequirePage("mrp")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard, ActionPermissionsGuard)
export class MrpController {
  constructor(private readonly service: MrpService) {}

  @Post("run")
  @Roles("ADMIN", "PLANNER")
  run(@CurrentUser() user: AuthUser) {
    return this.service.run(user.tenantId, user.userId);
  }

  @Post("runs")
  @Roles("ADMIN", "PLANNER")
  @RequireActionPermissions("MRP_RUN")
  runDaily(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(runDailyMrpSchema)) dto: RunDailyMrpDto) {
    return this.service.runDaily(user.tenantId, user.userId, dto);
  }

  @Get("runs")
  @RequireActionPermissions("MRP_READ")
  dailyRuns(@CurrentUser() user: AuthUser, @Query("plantId") plantId?: string) {
    return this.service.listDailyRuns(user.tenantId, plantId);
  }

  @Get("buckets")
  @RequireActionPermissions("MRP_READ")
  dailyBuckets(@CurrentUser() user: AuthUser, @Query("plantId") plantId?: string, @Query("runId") runId?: string, @Query("itemType") itemType?: string, @Query("itemId") itemId?: string) {
    return this.service.listDailyBuckets(user.tenantId, { plantId, runId, itemType, itemId });
  }

  @Get("proposals")
  @RequireActionPermissions("MRP_READ")
  dailyProposals(@CurrentUser() user: AuthUser, @Query("plantId") plantId?: string, @Query("status") status?: string, @Query("policy") policy?: string) {
    return this.service.listDailyProposals(user.tenantId, { plantId, status, policy });
  }

  @Get("proposals/:id")
  @RequireActionPermissions("MRP_READ")
  dailyProposal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findDailyProposal(user.tenantId, id);
  }

  @Patch("proposals/:id/firm")
  @Roles("ADMIN", "PLANNER")
  @RequireActionPermissions("MRP_FIRM")
  firmDailyProposal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.firmDailyProposal(user.tenantId, user.userId, id, true);
  }

  @Patch("proposals/:id/unfirm")
  @Roles("ADMIN", "PLANNER")
  @RequireActionPermissions("MRP_FIRM")
  unfirmDailyProposal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.firmDailyProposal(user.tenantId, user.userId, id, false);
  }

  @Post("proposals/:id/convert-make")
  @Roles("ADMIN", "PLANNER")
  @RequireActionPermissions("MRP_CONVERT_MAKE")
  convertMakeDailyProposal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.convertDailyProposal(user.tenantId, user.userId, id, "MAKE");
  }

  @Post("proposals/:id/convert-buy")
  @Roles("ADMIN", "PLANNER")
  @RequireActionPermissions("MRP_CONVERT_BUY")
  convertBuyDailyProposal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.convertDailyProposal(user.tenantId, user.userId, id, "BUY");
  }

  @Get("exceptions")
  @RequireActionPermissions("MRP_READ")
  exceptions(@CurrentUser() user: AuthUser, @Query("plantId") plantId?: string, @Query("severity") severity?: string, @Query("type") type?: string, @Query("status") status?: string) {
    return this.service.listExceptions(user.tenantId, { plantId, severity, type, status });
  }

  @Post("exceptions/:id/acknowledge")
  @Roles("ADMIN", "PLANNER")
  @RequireActionPermissions("MRP_FIRM")
  acknowledgeException(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.acknowledgeException(user.tenantId, user.userId, id);
  }

  @Post("parameters")
  @Roles("ADMIN", "PLANNER")
  @RequireActionPermissions("MRP_ADMIN_PARAMETERS")
  upsertParameter(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(mrpPlanningParameterSchema)) dto: MrpPlanningParameterDto) {
    return this.service.upsertPlanningParameter(user.tenantId, user.userId, dto);
  }

  @Post("independent-demand")
  @Roles("ADMIN", "PLANNER")
  @RequireActionPermissions("MRP_ADMIN_PARAMETERS")
  independentDemand(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createMrpIndependentDemandSchema)) dto: CreateMrpIndependentDemandDto) {
    return this.service.createIndependentDemand(user.tenantId, user.userId, dto);
  }

  @Get("capacity-readiness")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  capacityReadiness(@CurrentUser() user: AuthUser) {
    return this.service.capacityReadiness(user.tenantId);
  }

  @Get("purchase-proposals")
  listPurchaseProposals(@CurrentUser() user: AuthUser, @Query("status") status?: string) {
    return this.service.listPurchaseProposals(user.tenantId, status);
  }

  @Get("purchase-proposals/:id")
  findPurchaseProposal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findPurchaseProposal(user.tenantId, id);
  }

  @Patch("purchase-proposals/:id/submit")
  @Roles("ADMIN", "PLANNER")
  submitPurchaseProposal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.submitPurchaseProposal(user.tenantId, user.userId, id);
  }

  @Patch("purchase-proposals/:id/approve")
  @Roles("ADMIN", "PLANNER")
  approvePurchaseProposal(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(mrpProposalDecisionSchema)) dto: MrpProposalDecisionDto,
  ) {
    return this.service.decidePurchaseProposal(
      user.tenantId,
      id,
      user.userId,
      user.role,
      "approve",
      dto.note,
      dto.supplierId,
      dto.password,
    );
  }

  @Patch("purchase-proposals/:id/reject")
  @Roles("ADMIN", "PLANNER")
  rejectPurchaseProposal(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(mrpProposalDecisionSchema)) dto: MrpProposalDecisionDto,
  ) {
    return this.service.decidePurchaseProposal(user.tenantId, id, user.userId, user.role, "reject", dto.note, undefined, dto.password);
  }

  @Get("production-proposals")
  listProductionProposals(@CurrentUser() user: AuthUser, @Query("status") status?: string) {
    return this.service.listProductionProposals(user.tenantId, status);
  }

  @Get("production-proposals/:id")
  findProductionProposal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findProductionProposal(user.tenantId, id);
  }

  @Patch("production-proposals/:id/submit")
  @Roles("ADMIN", "PLANNER")
  submitProductionProposal(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.submitProductionProposal(user.tenantId, user.userId, id);
  }

  @Patch("production-proposals/:id/approve")
  @Roles("ADMIN", "PLANNER")
  approveProductionProposal(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(mrpProposalDecisionSchema)) dto: MrpProposalDecisionDto,
  ) {
    return this.service.decideProductionProposal(user.tenantId, id, user.userId, user.role, "approve", dto.note, dto.password);
  }

  @Patch("production-proposals/:id/reject")
  @Roles("ADMIN", "PLANNER")
  rejectProductionProposal(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(mrpProposalDecisionSchema)) dto: MrpProposalDecisionDto,
  ) {
    return this.service.decideProductionProposal(user.tenantId, id, user.userId, user.role, "reject", dto.note, dto.password);
  }
}
