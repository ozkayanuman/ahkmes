import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createMachineConnectionSchema,
  updateMachinePositionSchema,
  type CreateMachineConnectionDto,
  type UpdateMachinePositionDto,
} from "@ahkmes/shared-types";
import { DigitalTwinService } from "./digital-twin.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { parseOeeCalculationContext } from "../oee/oee-request";
import { ActionPermissionsGuard } from "../common/guards/action-permissions.guard";
import { RequireActionPermissions } from "../common/decorators/require-action-permission.decorator";

const WRITE_ROLES = ["ADMIN", "PLANNER", "FOREMAN"] as const;

@Controller("digital-twin")
@RequirePage("digital-twin")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard, ActionPermissionsGuard)
export class DigitalTwinController {
  constructor(private readonly service: DigitalTwinService) {}

  @Get("layout")
  @RequireActionPermissions("OEE_READ")
  layout(
    @CurrentUser() user: AuthUser,
    @Query("plantId") plantId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("asOf") asOf?: string,
  ) {
    return this.service.layout(user.tenantId, parseOeeCalculationContext(plantId, from, to, asOf));
  }

  @Patch("machines/:id/position")
  @Roles(...WRITE_ROLES)
  setPosition(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateMachinePositionSchema)) dto: UpdateMachinePositionDto,
  ) {
    return this.service.setPosition(user.tenantId, id, dto);
  }

  @Post("connections")
  @Roles(...WRITE_ROLES)
  createConnection(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createMachineConnectionSchema)) dto: CreateMachineConnectionDto,
  ) {
    return this.service.createConnection(user.tenantId, dto);
  }

  @Delete("connections/:id")
  @Roles(...WRITE_ROLES)
  removeConnection(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.removeConnection(user.tenantId, id);
  }
}
