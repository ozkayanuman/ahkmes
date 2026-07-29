import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  assignGroupMemberSchema,
  createPermissionGroupSchema,
  updatePermissionGroupSchema,
  type AssignGroupMemberDto,
  type CreatePermissionGroupDto,
  type UpdatePermissionGroupDto,
} from "@ahkmes/shared-types";
import { PermissionGroupsService } from "./permission-groups.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("permission-groups")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class PermissionGroupsController {
  constructor(private readonly service: PermissionGroupsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.tenantId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createPermissionGroupSchema)) dto: CreatePermissionGroupDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePermissionGroupSchema)) dto: UpdatePermissionGroupDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Post(":id/members")
  addMember(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(assignGroupMemberSchema)) dto: AssignGroupMemberDto,
  ) {
    return this.service.addMember(user.tenantId, id, dto.userId);
  }

  @Delete(":id/members/:userId")
  removeMember(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("userId") userId: string) {
    return this.service.removeMember(user.tenantId, id, userId);
  }
}
