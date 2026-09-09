import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import type { AuthUser } from "../common/types";
import { SchedulingService } from "./scheduling.service";

function parseDate(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException("Geçersiz tarih");
  return parsed;
}

@Controller("scheduling")
@RequirePage("scheduling")
@UseGuards(JwtAuthGuard, PagesGuard)
export class SchedulingController {
  constructor(private readonly service: SchedulingService) {}

  @Get("capacity")
  capacity(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const defaultTo = new Date(today);
    defaultTo.setDate(defaultTo.getDate() + 13);
    const fromDate = parseDate(from, today);
    const toDate = parseDate(to, defaultTo);
    if (toDate < fromDate) throw new BadRequestException("'to' 'from'dan önce olamaz");
    return this.service.capacity(user.tenantId, fromDate, toDate);
  }
}
