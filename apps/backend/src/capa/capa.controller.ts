import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createCapaSchema,
  decideCapaSchema,
  updateCapaSchema,
  type CreateCapaDto,
  type DecideCapaDto,
  type UpdateCapaDto,
} from "@ahkmes/shared-types";
import { CapaService } from "./capa.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("capa")
@RequirePage("capa")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class CapaController {
  constructor(private readonly service: CapaService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("status") status?: string) {
    return this.service.findAll(user.tenantId, status);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCapaSchema)) dto: CreateCapaDto,
  ) {
    return this.service.create(user.tenantId, user.userId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCapaSchema)) dto: UpdateCapaDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Patch(":id/submit")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  submit(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.submitForApproval(user.tenantId, user.userId, id);
  }

  @Patch(":id/approve")
  @Roles("ADMIN")
  approve(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decideCapaSchema)) dto: DecideCapaDto,
  ) {
    return this.service.decide(user.tenantId, id, user.userId, user.role, "approve", dto.note, dto.password);
  }

  @Patch(":id/reject")
  @Roles("ADMIN")
  reject(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decideCapaSchema)) dto: DecideCapaDto,
  ) {
    return this.service.decide(user.tenantId, id, user.userId, user.role, "reject", dto.note, dto.password);
  }

  @Patch(":id/close")
  @Roles("ADMIN", "PLANNER")
  close(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.close(user.tenantId, id);
  }
}
