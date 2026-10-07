import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createGlAccountSchema,
  createJournalEntrySchema,
  fiscalPeriodRefSchema,
  reverseJournalEntrySchema,
  setGlPostingAccountSchema,
  updateGlAccountSchema,
  type CreateGlAccountDto,
  type CreateJournalEntryDto,
  type FiscalPeriodRefDto,
  type ReverseJournalEntryDto,
  type SetGlPostingAccountDto,
  type UpdateGlAccountDto,
} from "@ahkmes/shared-types";
import { GlService } from "./gl.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

function parseDate(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException("Geçersiz tarih");
  return parsed;
}

function range(from?: string, to?: string) {
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const fromDate = parseDate(from, defaultFrom);
  const toDate = parseDate(to, now);
  if (toDate < fromDate) throw new BadRequestException("'to' 'from'dan önce olamaz");
  return { fromDate, toDate };
}

@Controller("gl")
@RequirePage("gl")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class GlController {
  constructor(private readonly service: GlService) {}

  // ---- chart of accounts ----
  @Get("accounts")
  accounts(@CurrentUser() user: AuthUser) {
    return this.service.listAccounts(user.tenantId);
  }

  @Post("accounts")
  @Roles("ADMIN", "PLANNER")
  createAccount(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createGlAccountSchema)) dto: CreateGlAccountDto) {
    return this.service.createAccount(user.tenantId, dto);
  }

  @Patch("accounts/:id")
  @Roles("ADMIN", "PLANNER")
  updateAccount(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(updateGlAccountSchema)) dto: UpdateGlAccountDto) {
    return this.service.updateAccount(user.tenantId, id, dto);
  }

  @Post("accounts/seed-default")
  @Roles("ADMIN")
  seedDefault(@CurrentUser() user: AuthUser) {
    return this.service.seedDefaultChart(user.tenantId);
  }

  @Get("accounts/:id/ledger")
  ledger(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query("from") from?: string, @Query("to") to?: string) {
    const { fromDate, toDate } = range(from, to);
    return this.service.accountLedger(user.tenantId, id, fromDate, toDate);
  }

  // ---- posting map ----
  @Get("posting-accounts")
  postingAccounts(@CurrentUser() user: AuthUser) {
    return this.service.listPostingAccounts(user.tenantId);
  }

  @Post("posting-accounts")
  @Roles("ADMIN")
  setPostingAccount(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(setGlPostingAccountSchema)) dto: SetGlPostingAccountDto) {
    return this.service.setPostingAccount(user.tenantId, dto);
  }

  // ---- fiscal periods ----
  @Get("periods")
  periods(@CurrentUser() user: AuthUser) {
    return this.service.listPeriods(user.tenantId);
  }

  @Post("periods/close")
  @Roles("ADMIN")
  closePeriod(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(fiscalPeriodRefSchema)) dto: FiscalPeriodRefDto) {
    return this.service.closePeriod(user.tenantId, user.userId, dto);
  }

  @Post("periods/reopen")
  @Roles("ADMIN")
  reopenPeriod(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(fiscalPeriodRefSchema)) dto: FiscalPeriodRefDto) {
    return this.service.reopenPeriod(user.tenantId, dto);
  }

  // ---- journal ----
  @Get("entries")
  entries(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: string,
    @Query("sourceType") sourceType?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.service.listEntries(user.tenantId, {
      status: status || undefined,
      sourceType: sourceType || undefined,
      from: from ? parseDate(from, new Date()) : undefined,
      to: to ? parseDate(to, new Date()) : undefined,
    });
  }

  @Get("entries/:id")
  entry(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.getEntry(user.tenantId, id);
  }

  @Post("entries")
  @Roles("ADMIN", "PLANNER")
  createEntry(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createJournalEntrySchema)) dto: CreateJournalEntryDto) {
    return this.service.createEntry(user.tenantId, user.userId, dto);
  }

  @Post("entries/:id/post")
  @Roles("ADMIN", "PLANNER")
  postEntry(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.postEntry(user.tenantId, user.userId, id);
  }

  @Post("entries/:id/reverse")
  @Roles("ADMIN", "PLANNER")
  reverseEntry(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(reverseJournalEntrySchema)) dto: ReverseJournalEntryDto) {
    return this.service.reverseEntry(user.tenantId, user.userId, id, dto);
  }

  @Delete("entries/:id")
  @Roles("ADMIN", "PLANNER")
  deleteDraft(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.deleteDraft(user.tenantId, id);
  }

  // ---- reports & subledger sync ----
  @Get("trial-balance")
  trialBalance(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    const { fromDate, toDate } = range(from, to);
    return this.service.trialBalance(user.tenantId, fromDate, toDate);
  }

  @Post("sync")
  @Roles("ADMIN", "PLANNER")
  sync(@CurrentUser() user: AuthUser) {
    return this.service.syncSubledgers(user.tenantId, user.userId);
  }
}
