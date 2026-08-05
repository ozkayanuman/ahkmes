import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { mrpProposalDecisionSchema, type MrpProposalDecisionDto } from "@ahkmes/shared-types";
import { MrpService } from "./mrp.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("mrp")
@RequirePage("mrp")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class MrpController {
  constructor(private readonly service: MrpService) {}

  @Post("run")
  @Roles("ADMIN", "PLANNER")
  run(@CurrentUser() user: AuthUser) {
    return this.service.run(user.tenantId, user.userId);
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
