import { BadRequestException, Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ProductModule } from "@prisma/client";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { PlatformModulesService } from "./platform-modules.service";

@Controller("platform/modules")
@UseGuards(JwtAuthGuard)
export class PlatformModulesController {
  constructor(private readonly service: PlatformModulesService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.service.list(user.tenantId); }
  @Get("catalog") catalog() { return this.service.catalog(); }
  @Patch(":module")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  set(@CurrentUser() user: AuthUser, @Param("module") module: string, @Body() body: { isEnabled?: boolean }) {
    if (!Object.values(ProductModule).includes(module as ProductModule) || typeof body.isEnabled !== "boolean") {
      throw new BadRequestException("Geçerli bir modül ve isEnabled boolean değeri gerekli");
    }
    return this.service.set(user.tenantId, user.userId, module as ProductModule, body.isEnabled);
  }
}
