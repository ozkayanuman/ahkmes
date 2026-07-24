import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  startProductionRunSchema,
  updateProductionRunSchema,
  type StartProductionRunDto,
} from "@ahkmes/shared-types";
import { z } from "zod";
import { ProductionService } from "./production.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

type UpdateRunDto = z.infer<typeof updateProductionRunSchema>;

const RUN_ROLES = ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"] as const;

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductionController {
  constructor(private readonly service: ProductionService) {}

  @Get("runs")
  findAll(
    @CurrentUser() user: AuthUser,
    @Query("workOrderId") workOrderId?: string,
    @Query("active") active?: string,
  ) {
    return this.service.findAll(user.tenantId, workOrderId, active === "true");
  }

  @Post("work-orders/:id/runs")
  @Roles(...RUN_ROLES)
  start(
    @CurrentUser() user: AuthUser,
    @Param("id") workOrderId: string,
    @Body(new ZodValidationPipe(startProductionRunSchema)) dto: StartProductionRunDto,
  ) {
    return this.service.start(user.tenantId, user.userId, workOrderId, dto);
  }

  @Patch("runs/:id")
  @Roles(...RUN_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductionRunSchema)) dto: UpdateRunDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Post("runs/:id/complete")
  @Roles(...RUN_ROLES)
  complete(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductionRunSchema)) dto: UpdateRunDto,
  ) {
    return this.service.complete(user.tenantId, id, dto);
  }
}
