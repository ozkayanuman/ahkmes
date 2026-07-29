import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createNonConformanceSchema,
  resolveNonConformanceSchema,
  type CreateNonConformanceDto,
  type ResolveNonConformanceDto,
} from "@ahkmes/shared-types";
import { NonConformanceService } from "./non-conformance.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

const WRITE_ROLES = ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"] as const;

@Controller("non-conformances")
@UseGuards(JwtAuthGuard, RolesGuard)
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
}
