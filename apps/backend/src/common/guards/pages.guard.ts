import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ProductModule } from "@prisma/client";
import type { PageKey } from "@ahkmes/shared-types";
import { PAGES_KEY } from "../decorators/require-page.decorator";
import { PRODUCT_MODULES_KEY } from "../decorators/require-product-module.decorator";
import { PAGE_PRODUCT_MODULE } from "../module-entitlement";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthUser } from "../types";

@Injectable()
export class PagesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PageKey[] | undefined>(PAGES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException("Bu sayfa için yetkiniz yok");
    if (user.pages !== "*" && !required.some((page) => user.pages.includes(page))) {
      throw new ForbiddenException("Bu sayfa için yetkiniz yok");
    }

    const explicitModules = this.reflector.getAllAndOverride<ProductModule[] | undefined>(PRODUCT_MODULES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];
    const requiredModules = [...new Set([...required.map((page) => PAGE_PRODUCT_MODULE[page]), ...explicitModules])]
      .filter((module): module is ProductModule => module !== "PLATFORM_CORE");
    const disabled = requiredModules.length === 0
      ? []
      : await this.prisma.tenantModuleEntitlement.findMany({
          where: { tenantId: user.tenantId, module: { in: requiredModules }, isEnabled: false },
          select: { module: true },
        });
    if (disabled.length > 0) {
      throw new ForbiddenException("Bu modül bu tenant için etkin değil");
    }
    return true;
  }
}
