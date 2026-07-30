import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  createSpcCharacteristicSchema,
  createSpcMeasurementSchema,
  type CreateSpcCharacteristicDto,
  type CreateSpcMeasurementDto,
} from "@ahkmes/shared-types";
import { SpcService } from "./spc.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("spc")
@RequirePage("spc")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class SpcController {
  constructor(private readonly service: SpcService) {}

  @Get("characteristics")
  findCharacteristics(@CurrentUser() user: AuthUser, @Query("partId") partId?: string) {
    return this.service.findCharacteristics(user.tenantId, partId);
  }

  @Get("characteristics/:id")
  findCharacteristic(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findCharacteristic(user.tenantId, id);
  }

  @Get("characteristics/:id/stats")
  stats(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.stats(user.tenantId, id);
  }

  @Post("characteristics")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  createCharacteristic(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSpcCharacteristicSchema)) dto: CreateSpcCharacteristicDto,
  ) {
    return this.service.createCharacteristic(user.tenantId, dto);
  }

  @Delete("characteristics/:id")
  @Roles("ADMIN")
  removeCharacteristic(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.removeCharacteristic(user.tenantId, id);
  }

  @Get("measurements")
  findMeasurements(@CurrentUser() user: AuthUser, @Query("characteristicId") characteristicId: string) {
    return this.service.findMeasurements(user.tenantId, characteristicId);
  }

  @Post("measurements")
  @Roles("ADMIN", "PLANNER", "FOREMAN", "OPERATOR")
  recordMeasurement(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSpcMeasurementSchema)) dto: CreateSpcMeasurementDto,
  ) {
    return this.service.recordMeasurement(user.tenantId, user.userId, dto);
  }
}
