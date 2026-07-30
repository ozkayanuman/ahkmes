import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createCustomerNoteSchema, type CreateCustomerNoteDto } from "@ahkmes/shared-types";
import { CustomerNotesService } from "./customer-notes.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("customers/:customerId/notes")
@RequirePage("customers")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class CustomerNotesController {
  constructor(private readonly service: CustomerNotesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param("customerId") customerId: string) {
    return this.service.list(user.tenantId, customerId);
  }

  @Post()
  @Roles("ADMIN", "SALES")
  create(
    @CurrentUser() user: AuthUser,
    @Param("customerId") customerId: string,
    @Body(new ZodValidationPipe(createCustomerNoteSchema)) dto: CreateCustomerNoteDto,
  ) {
    return this.service.create(user.tenantId, customerId, user.userId, dto);
  }
}
