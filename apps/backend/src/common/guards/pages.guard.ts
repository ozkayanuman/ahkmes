import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PageKey } from "@ahkmes/shared-types";
import { PAGES_KEY } from "../decorators/require-page.decorator";
import type { AuthUser } from "../types";

@Injectable()
export class PagesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PageKey[] | undefined>(PAGES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException("Bu sayfa için yetkiniz yok");
    if (user.pages === "*") return true;
    if (required.some((p) => user.pages.includes(p))) return true;
    throw new ForbiddenException("Bu sayfa için yetkiniz yok");
  }
}
