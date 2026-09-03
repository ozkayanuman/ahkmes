import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { createProductionDefinitionSchema, engineeringStatusChangeSchema, type CreateProductionDefinitionDto, type EngineeringStatusChangeDto } from "@ahkmes/shared-types";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { ProductionDefinitionsService } from "./production-definitions.service";
@Controller("production-definitions") @RequirePage("recipes") @UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class ProductionDefinitionsController {
  constructor(private readonly service: ProductionDefinitionsService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query("plantId") plantId?: string, @Query("partId") partId?: string) { return this.service.list(user.tenantId, plantId, partId); }
  @Post() @Roles("ADMIN", "PLANNER") create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createProductionDefinitionSchema)) dto: CreateProductionDefinitionDto) { return this.service.create(user.tenantId, user.userId, dto); }
  @Patch(":id/status") @Roles("ADMIN", "PLANNER") status(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(engineeringStatusChangeSchema)) dto: EngineeringStatusChangeDto) { return this.service.setStatus(user.tenantId, user.userId, id, dto); }
}
