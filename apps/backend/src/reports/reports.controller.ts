import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ReportsService } from "./reports.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

@Controller("reports")
@RequirePage("reports")
@UseGuards(JwtAuthGuard, PagesGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get("work-orders.csv")
  async workOrdersCsv(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const csv = await this.service.workOrdersCsv(user.tenantId, status, from, to);
    res
      .set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="is-emirleri.csv"' })
      .send(csv);
  }

  @Get("non-conformances.csv")
  async nonConformancesCsv(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const csv = await this.service.nonConformancesCsv(user.tenantId, status, from, to);
    res
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="uygunsuzluklar.csv"',
      })
      .send(csv);
  }
}
