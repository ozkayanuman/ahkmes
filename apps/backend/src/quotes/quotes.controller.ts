import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  convertQuoteSchema,
  createQuoteSchema,
  quoteLineInputSchema,
  quoteStatusUpdateSchema,
  updateQuoteLineSchema,
  updateQuoteSchema,
  type ConvertQuoteDto,
  type CreateQuoteDto,
  type QuoteLineInputDto,
  type QuoteStatusUpdateDto,
  type UpdateQuoteDto,
  type UpdateQuoteLineDto,
} from "@ahkmes/shared-types";
import type { QuoteStatus } from "@prisma/client";
import { QuotesService } from "./quotes.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("quotes")
@RequirePage("quotes")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class QuotesController {
  constructor(private readonly service: QuotesService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: QuoteStatus,
    @Query("q") q?: string,
  ) {
    return this.service.findAll(user.tenantId, status, q);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "SALES")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createQuoteSchema)) dto: CreateQuoteDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "SALES")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateQuoteSchema)) dto: UpdateQuoteDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Patch(":id/status")
  @Roles("ADMIN", "SALES")
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(quoteStatusUpdateSchema)) dto: QuoteStatusUpdateDto,
  ) {
    return this.service.setStatus(user.tenantId, id, dto.status);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Post(":id/lines")
  @Roles("ADMIN", "SALES")
  addLine(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(quoteLineInputSchema)) dto: QuoteLineInputDto,
  ) {
    return this.service.addLine(user.tenantId, id, dto);
  }

  @Patch(":id/lines/:lineId")
  @Roles("ADMIN", "SALES")
  updateLine(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body(new ZodValidationPipe(updateQuoteLineSchema)) dto: UpdateQuoteLineDto,
  ) {
    return this.service.updateLine(user.tenantId, id, lineId, dto);
  }

  @Delete(":id/lines/:lineId")
  @Roles("ADMIN", "SALES")
  removeLine(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
  ) {
    return this.service.removeLine(user.tenantId, id, lineId);
  }

  @Post(":id/convert")
  @Roles("ADMIN", "PLANNER")
  convert(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(convertQuoteSchema)) dto: ConvertQuoteDto,
  ) {
    return this.service.convert(user.tenantId, id, dto);
  }
}
