import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { createMaterialSerialNumberSchema, type CreateMaterialSerialNumberDto } from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { MaterialSerialNumbersService } from "./material-serial-numbers.service";
@Controller("material-serial-numbers") @RequirePage("materials") @UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class MaterialSerialNumbersController { constructor(private readonly service: MaterialSerialNumbersService) {} @Get() findAll(@CurrentUser() u: AuthUser, @Query("materialId") materialId?: string, @Query("lotId") lotId?: string) { return this.service.findAll(u.tenantId, materialId, lotId); } @Post() @Roles("ADMIN", "PLANNER", "FOREMAN") create(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createMaterialSerialNumberSchema)) dto: CreateMaterialSerialNumberDto) { return this.service.create(u.tenantId, dto); } }
