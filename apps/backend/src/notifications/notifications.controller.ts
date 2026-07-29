import { Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.tenantId, user.userId);
  }

  @Get("unread-count")
  async unreadCount(@CurrentUser() user: AuthUser) {
    return { count: await this.service.unreadCount(user.tenantId, user.userId) };
  }

  @Patch(":id/read")
  markRead(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.markRead(user.tenantId, user.userId, id);
  }

  @Patch("read-all")
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.service.markAllRead(user.tenantId, user.userId);
  }
}
