import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ActionPermissionsService, TOOLING_ACTIONS } from "./action-permissions.service";
const grantSchema = z.object({ action: z.enum(TOOLING_ACTIONS), role: z.enum(["ADMIN", "SALES", "PLANNER", "FOREMAN", "OPERATOR"]).optional(), userId: z.string().uuid().optional() }).refine((v) => Boolean(v.role) !== Boolean(v.userId), "Tam olarak bir rol veya kullanıcı seçin");
@Controller("action-permissions") @RequirePage("users") @UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class ActionPermissionsController {
  constructor(private readonly service: ActionPermissionsService) {}
  @Get() @Roles("ADMIN") list(@CurrentUser() u: AuthUser) { return this.service.list(u.tenantId); }
  @Get("me") me(@CurrentUser() u: AuthUser) { return this.service.grantedActions(u.tenantId, u.userId, u.role); }
  @Post() @Roles("ADMIN") grant(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(grantSchema)) dto: z.infer<typeof grantSchema>) { return this.service.grant(u.tenantId, u.userId, dto); }
  @Delete(":id") @Roles("ADMIN") revoke(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.service.revoke(u.tenantId, u.userId, id); }
}
