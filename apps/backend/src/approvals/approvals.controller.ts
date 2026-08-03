import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createApprovalRequestSchema,
  decideApprovalSchema,
  type CreateApprovalRequestDto,
  type DecideApprovalDto,
} from "@ahkmes/shared-types";
import { ApprovalsService } from "./approvals.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { SkipAudit } from "../common/decorators/skip-audit.decorator";

@Controller("approvals")
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(private readonly service: ApprovalsService) {}

  @Post()
  @SkipAudit()
  request(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createApprovalRequestSchema)) dto: CreateApprovalRequestDto,
  ) {
    return this.service.request(user.tenantId, user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("status") status?: "PENDING" | "APPROVED" | "REJECTED") {
    return this.service.list(user.tenantId, user.role, status);
  }

  @Patch(":id/approve")
  @SkipAudit()
  approve(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decideApprovalSchema)) dto: DecideApprovalDto,
  ) {
    return this.service.approve(user.tenantId, id, user.userId, user.role, dto.note);
  }

  @Patch(":id/reject")
  @SkipAudit()
  reject(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decideApprovalSchema)) dto: DecideApprovalDto,
  ) {
    return this.service.reject(user.tenantId, id, user.userId, user.role, dto.note);
  }
}
