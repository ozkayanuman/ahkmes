import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { LaborService } from "./labor.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

@Controller("labor")
@RequirePage("labor")
@UseGuards(JwtAuthGuard, PagesGuard)
export class LaborController {
  constructor(private readonly service: LaborService) {}

  @Get("summary")
  summary(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    return this.service.summary(user.tenantId, from, to);
  }
}
