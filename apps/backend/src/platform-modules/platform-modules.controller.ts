import { BadRequestException, Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ProductModule } from "@prisma/client";
import { PRODUCT_EDITIONS, type ProductEdition } from "@ahkmes/shared-types";
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

  @Get("edition")
  async getEdition(@CurrentUser() user: AuthUser) {
    return { edition: await this.service.getEdition(user.tenantId) };
  }

  @Patch("edition")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  setEdition(@CurrentUser() user: AuthUser, @Body() body: { edition?: string }) {
    if (!PRODUCT_EDITIONS.includes(body.edition as ProductEdition)) {
      throw new BadRequestException("Geçerli bir edition değeri gerekli");
    }
    return this.service.setEdition(user.tenantId, user.userId, body.edition as ProductEdition);
  }

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
