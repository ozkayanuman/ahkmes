import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { convertUomSchema, createUomDefinitionSchema, type ConvertUomDto, type CreateUomDefinitionDto } from "@ahkmes/shared-types";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { UomService } from "./uom.service";

@Controller("uom")
@RequirePage("materials")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class UomController {
  constructor(private readonly service: UomService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.service.list(user.tenantId); }
  @Post() @Roles("ADMIN", "PLANNER") create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createUomDefinitionSchema)) dto: CreateUomDefinitionDto) { return this.service.create(user.tenantId, dto); }
  @Post("convert") convert(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(convertUomSchema)) dto: ConvertUomDto) { return this.service.convert(user.tenantId, dto); }
}
