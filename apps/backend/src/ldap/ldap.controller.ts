import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ldapConfigSchema, type LdapConfigDto } from "@ahkmes/shared-types";
import { LdapService } from "./ldap.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("ldap")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class LdapController {
  constructor(private readonly service: LdapService) {}

  @Get("config")
  getConfig(@CurrentUser() user: AuthUser) {
    return this.service.getConfig(user.tenantId);
  }

  @Post("config")
  upsertConfig(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ldapConfigSchema)) dto: LdapConfigDto,
  ) {
    return this.service.upsertConfig(user.tenantId, dto);
  }

  @Post("test-connection")
  testConnection(@Body(new ZodValidationPipe(ldapConfigSchema)) dto: LdapConfigDto) {
    return this.service.testConnection(dto);
  }

  @Post("sync")
  sync(@CurrentUser() user: AuthUser) {
    return this.service.syncUsers(user.tenantId);
  }
}
