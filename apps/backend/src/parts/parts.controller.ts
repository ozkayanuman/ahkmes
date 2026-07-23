import {
  BadRequestException,
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
  createNcProgramSchema,
  createPartSchema,
  updatePartSchema,
  type CreateNcProgramDto,
  type CreatePartDto,
  type UpdatePartDto,
} from "@ahkmes/shared-types";
import { PartsService } from "./parts.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("parts")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PartsController {
  constructor(private readonly service: PartsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query("q") q?: string) {
    return this.service.findAll(user.tenantId, q);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN", "PLANNER")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPartSchema)) dto: CreatePartDto,
  ) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "PLANNER")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePartSchema)) dto: UpdatePartDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Get(":id/nc-programs")
  listNcPrograms(@CurrentUser() user: AuthUser, @Param("id") partId: string) {
    return this.service.listNcPrograms(user.tenantId, partId);
  }

  @Post(":id/nc-programs")
  @Roles("ADMIN", "PLANNER")
  addNcProgram(
    @CurrentUser() user: AuthUser,
    @Param("id") partId: string,
    @Body() body: Omit<CreateNcProgramDto, "partId">,
  ) {
    const parsed = createNcProgramSchema.safeParse({ ...body, partId });
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.addNcProgram(user.tenantId, user.userId, parsed.data);
  }
}
