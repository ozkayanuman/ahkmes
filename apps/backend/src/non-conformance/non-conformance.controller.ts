import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createNonConformanceSchema,
  decideCapaSchema,
  resolveNonConformanceSchema,
  type CreateNonConformanceDto,
  type DecideCapaDto,
  type ResolveNonConformanceDto,
} from "@ahkmes/shared-types";
import { NonConformanceService } from "./non-conformance.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

const WRITE_ROLES = ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"] as const;

@Controller("non-conformances")
@RequirePage("non-conformances")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class NonConformanceController {
  constructor(private readonly service: NonConformanceService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query("workOrderId") workOrderId?: string,
    @Query("status") status?: string,
  ) {
    return this.service.findAll(user.tenantId, workOrderId, status);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createNonConformanceSchema)) dto: CreateNonConformanceDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Patch(":id/resolve")
  @Roles(...WRITE_ROLES)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resolveNonConformanceSchema)) dto: ResolveNonConformanceDto,
  ) {
    return this.service.resolve(user.tenantId, user.userId, id, dto);
  }

  @Patch(":id/request-deviation")
  @Roles(...WRITE_ROLES)
  requestDeviation(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.requestDeviation(user.tenantId, user.userId, id);
  }

  @Patch(":id/approve-deviation")
  @Roles("ADMIN")
  approveDeviation(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decideCapaSchema)) dto: DecideCapaDto,
  ) {
    return this.service.decideDeviation(user.tenantId, id, user.userId, user.role, "approve", dto.note, dto.password);
  }

  @Patch(":id/reject-deviation")
  @Roles("ADMIN")
  rejectDeviation(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decideCapaSchema)) dto: DecideCapaDto,
  ) {
    return this.service.decideDeviation(user.tenantId, id, user.userId, user.role, "reject", dto.note, dto.password);
  }
}
