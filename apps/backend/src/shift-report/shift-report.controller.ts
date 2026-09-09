import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ShiftReportService } from "./shift-report.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

function parseProductionDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("date zorunlu ve YYYY-MM-DD olmalıdır");
  if (Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) throw new BadRequestException("date geçerli bir tarih olmalıdır");
  return value;
}

function parseAsOf(value: string | undefined) {
  const asOf = value ? new Date(value) : undefined;
  if (!asOf || Number.isNaN(asOf.getTime())) throw new BadRequestException("asOf zorunlu ve geçerli bir ISO-8601 tarih olmalıdır");
  return asOf;
}

@Controller("shift-report")
@RequirePage("shift-report")
@UseGuards(JwtAuthGuard, PagesGuard)
export class ShiftReportController {
  constructor(private readonly service: ShiftReportService) {}

  @Get()
  report(@CurrentUser() user: AuthUser, @Query("plantId") plantId?: string, @Query("date") date?: string, @Query("asOf") asOf?: string) {
    if (!plantId?.trim()) throw new BadRequestException("plantId zorunludur");
    return this.service.report({ tenantId: user.tenantId, plantId, productionDate: parseProductionDate(date), asOf: parseAsOf(asOf) });
  }
}
