import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createOidcProviderSchema, type CreateOidcProviderDto } from "@ahkmes/shared-types";
import { OidcProvidersService } from "./oidc-providers.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("oidc-providers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class OidcProvidersController {
  constructor(private readonly service: OidcProvidersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createOidcProviderSchema)) dto: CreateOidcProviderDto,
  ) {
    return this.service.create(user.tenantId, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
