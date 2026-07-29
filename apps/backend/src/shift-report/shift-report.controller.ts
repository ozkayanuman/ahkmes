import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ShiftReportService } from "./shift-report.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

function parseDate(raw: string | undefined) {
  if (!raw) return new Date();
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

@Controller("shift-report")
@UseGuards(JwtAuthGuard)
export class ShiftReportController {
  constructor(private readonly service: ShiftReportService) {}

  @Get()
  report(@CurrentUser() user: AuthUser, @Query("date") date?: string) {
    return this.service.report(user.tenantId, parseDate(date));
  }
}
