import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createWebhookSubscriptionSchema,
  updateWebhookSubscriptionSchema,
  type CreateWebhookSubscriptionDto,
  type UpdateWebhookSubscriptionDto,
} from "@ahkmes/shared-types";
import { WebhooksService } from "./webhooks.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

/** Sadece ADMIN — dış URL'lere sistem verisi gönderen bir yapılandırma, kapsamı
 * kasıtlı olarak diğer sayfa-bazlı rollerden daha dar tutuldu. */
@Controller("webhooks")
@RequirePage("webhooks")
@Roles("ADMIN")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWebhookSubscriptionSchema)) dto: CreateWebhookSubscriptionDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWebhookSubscriptionSchema)) dto: UpdateWebhookSubscriptionDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
