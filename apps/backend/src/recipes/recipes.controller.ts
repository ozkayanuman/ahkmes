import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createRecipeHeaderSchema,
  updateRecipeHeaderSchema,
  type CreateRecipeHeaderDto,
  type UpdateRecipeHeaderDto,
} from "@ahkmes/shared-types";
import { RecipesService } from "./recipes.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("recipes")
@RequirePage("recipes")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class RecipesController {
  constructor(private readonly service: RecipesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("partId") partId?: string) {
    return this.service.findAll(user.tenantId, partId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRecipeHeaderSchema)) dto: CreateRecipeHeaderDto,
  ) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateRecipeHeaderSchema)) dto: UpdateRecipeHeaderDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
