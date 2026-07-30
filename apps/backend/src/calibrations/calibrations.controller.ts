import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createCalibrationSchema, type CreateCalibrationDto } from "@ahkmes/shared-types";
import { CalibrationsService } from "./calibrations.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("calibrations")
@RequirePage("calibrations")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class CalibrationsController {
  constructor(private readonly service: CalibrationsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query("machineId") machineId?: string,
    @Query("dueBefore") dueBefore?: string,
  ) {
    return this.service.findAll(user.tenantId, machineId, dueBefore);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCalibrationSchema)) dto: CreateCalibrationDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }
}
