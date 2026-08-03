import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { createCopilotDraftSchema, type CreateCopilotDraftDto } from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CopilotService } from "./copilot.service";

@Controller("copilot")
@RequirePage("copilot")
@UseGuards(JwtAuthGuard, PagesGuard)
export class CopilotController {
  constructor(private readonly service: CopilotService) {}

  @Post("drafts")
  createDraft(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCopilotDraftSchema)) dto: CreateCopilotDraftDto,
  ) {
    return this.service.createDraft(user.tenantId, user.pages, dto);
  }
}
