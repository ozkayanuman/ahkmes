import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createCopilotDraftSchema, type CreateCopilotDraftDto } from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CopilotService } from "./copilot.service";

@Controller("copilot")
@RequirePage("copilot")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class CopilotController {
  constructor(private readonly service: CopilotService) {}

  @Post("drafts")
  createDraft(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCopilotDraftSchema)) dto: CreateCopilotDraftDto,
  ) {
    return this.service.createDraft(user.tenantId, user.pages, dto, user.userId);
  }

  @Get("drafts")
  listDrafts(@CurrentUser() user: AuthUser) {
    return this.service.listDrafts(user.tenantId);
  }

  @Post("drafts/:id/approve")
  @Roles("ADMIN", "PLANNER")
  approveDraft(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.approveDraft(user.tenantId, user.userId, id);
  }

  @Post("drafts/:id/reject")
  @Roles("ADMIN", "PLANNER")
  rejectDraft(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.rejectDraft(user.tenantId, user.userId, id);
  }
}
