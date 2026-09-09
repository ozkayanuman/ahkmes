import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ACTION_PERMISSIONS_KEY } from "../decorators/require-action-permission.decorator";
import { ActionPermissionsService } from "../../action-permissions/action-permissions.service";
import type { AuthUser } from "../types";

@Injectable()
export class ActionPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly permissions: ActionPermissionsService) {}
  async canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ACTION_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user || !(await this.permissions.hasAll(user.tenantId, user.userId, user.role, required))) throw new ForbiddenException("Bu işlem için gerekli action yetkisi yok");
    return true;
  }
}
