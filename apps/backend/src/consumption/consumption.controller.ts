import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  createConsumptionSchema,
  type CreateConsumptionDto,
} from "@ahkmes/shared-types";
import { ConsumptionService } from "./consumption.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("consumptions")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConsumptionController {
  constructor(private readonly service: ConsumptionService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("workOrderId") workOrderId?: string) {
    return this.service.findAll(user.tenantId, workOrderId);
  }

  @Post()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createConsumptionSchema)) dto: CreateConsumptionDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Delete(":id")
  @Roles("ADMIN", "PLANNER")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
