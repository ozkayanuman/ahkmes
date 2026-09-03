import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createBomHeaderSchema,
  updateBomHeaderSchema,
  type CreateBomHeaderDto,
  type UpdateBomHeaderDto,
  engineeringStatusChangeSchema,
  type EngineeringStatusChangeDto,
} from "@ahkmes/shared-types";
import { BomService } from "./bom.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("boms")
@RequirePage("mrp")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class BomController {
  constructor(private readonly service: BomService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("partId") partId?: string) {
    return this.service.findAll(user.tenantId, partId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createBomHeaderSchema)) dto: CreateBomHeaderDto,
  ) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "PLANNER")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateBomHeaderSchema)) dto: UpdateBomHeaderDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Patch(":id/status") @Roles("ADMIN", "PLANNER")
  status(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(engineeringStatusChangeSchema)) dto: EngineeringStatusChangeDto) { return this.service.setStatus(user.tenantId, user.userId, id, dto); }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
