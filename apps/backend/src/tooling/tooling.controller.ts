import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createFixtureCompatibilitySchema, createFixtureDefinitionSchema, createOperationFixtureRequirementSchema, createOperationToolRequirementSchema,
  createPhysicalFixtureSchema, createPhysicalToolSchema, createToolAssemblySchema, createToolCompatibilitySchema, createToolComponentSchema,
  createToolDefinitionSchema, invalidateSetupSchema, manualToolLifeAdjustmentSchema, setupAssignmentSchema, updateToolDefinitionSchema,
  type CreateFixtureDefinitionDto, type CreatePhysicalFixtureDto, type CreatePhysicalToolDto, type CreateToolAssemblyDto, type CreateToolComponentDto,
  type CreateToolDefinitionDto, type SetupAssignmentDto, type UpdateToolDefinitionDto,
} from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { RequireProductModule } from "../common/decorators/require-product-module.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ActionPermissionsGuard } from "../common/guards/action-permissions.guard";
import { RequireActionPermissions } from "../common/decorators/require-action-permission.decorator";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ToolingService } from "./tooling.service";
import { ActionPermissionsService } from "../action-permissions/action-permissions.service";

@Controller("tooling")
@RequirePage("tooling")
@RequireProductModule("MES_CNC_TOOLING")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard, ActionPermissionsGuard)
export class ToolingController {
  constructor(private readonly service: ToolingService, private readonly permissions: ActionPermissionsService) {}
  @Get() @RequireActionPermissions("TOOL_READ") list(@CurrentUser() user: AuthUser) { return this.service.list(user.tenantId); }
  @Get("fixture-definitions") @RequireActionPermissions("FIXTURE_READ") fixtures(@CurrentUser() user: AuthUser) { return this.service.listFixtures(user.tenantId); }
  @Get("actions") @RequireActionPermissions("TOOL_READ") actions(@CurrentUser() user: AuthUser) { return this.permissions.grantedActions(user.tenantId, user.userId, user.role); }

  @Post("tool-definitions") @RequireActionPermissions("TOOL_MANAGE") createToolDefinition(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createToolDefinitionSchema)) dto: CreateToolDefinitionDto) { return this.service.createToolDefinition(u.tenantId, dto); }
  @Patch("tool-definitions/:id") @RequireActionPermissions("TOOL_MANAGE") updateToolDefinition(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(updateToolDefinitionSchema)) dto: UpdateToolDefinitionDto) { return this.service.updateToolDefinition(u.tenantId, id, dto); }
  @Post("tool-components") @RequireActionPermissions("TOOL_MANAGE") createToolComponent(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createToolComponentSchema)) dto: CreateToolComponentDto) { return this.service.createToolComponent(u.tenantId, dto); }
  @Post("tool-assemblies") @RequireActionPermissions("TOOL_ASSEMBLY_MANAGE") createToolAssembly(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createToolAssemblySchema)) dto: CreateToolAssemblyDto) { return this.service.createToolAssembly(u.tenantId, dto); }
  @Post("physical-tools") @RequireActionPermissions("TOOL_MANAGE") createPhysicalTool(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createPhysicalToolSchema)) dto: CreatePhysicalToolDto) { return this.service.createPhysicalTool(u.tenantId, dto); }
  @Get("physical-tools/:id/life-events") @RequireActionPermissions("TOOL_READ") lifeHistory(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.service.lifeHistory(u.tenantId, id); }
  @Post("physical-tools/:id/life-adjustments") @RequireActionPermissions("TOOL_LIFE_ADJUST") adjustLife(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(manualToolLifeAdjustmentSchema)) dto: { consumedLife: number; version: number; reason: string }) { return this.service.adjustLife(u.tenantId, u.userId, id, dto); }

  @Post("fixture-definitions") @RequireActionPermissions("FIXTURE_MANAGE") createFixtureDefinition(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createFixtureDefinitionSchema)) dto: CreateFixtureDefinitionDto) { return this.service.createFixtureDefinition(u.tenantId, dto); }
  @Post("physical-fixtures") @RequireActionPermissions("FIXTURE_MANAGE") createPhysicalFixture(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createPhysicalFixtureSchema)) dto: CreatePhysicalFixtureDto) { return this.service.createPhysicalFixture(u.tenantId, dto); }
  @Post("tool-compatibilities") @RequireActionPermissions("TOOL_MANAGE") addToolCompatibility(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createToolCompatibilitySchema)) dto: { machineId: string; toolDefinitionId?: string; toolAssemblyId?: string }) { return this.service.addToolCompatibility(u.tenantId, dto); }
  @Post("fixture-compatibilities") @RequireActionPermissions("FIXTURE_MANAGE") addFixtureCompatibility(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createFixtureCompatibilitySchema)) dto: { machineId: string; fixtureDefinitionId: string }) { return this.service.addFixtureCompatibility(u.tenantId, dto); }

  @Post("recipe-steps/:id/tool-requirements") @RequireActionPermissions("OPERATION_SETUP_MANAGE") recipeToolRequirement(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(createOperationToolRequirementSchema)) dto: any) { return this.service.createRecipeToolRequirement(u.tenantId, id, dto); }
  @Post("recipe-steps/:id/fixture-requirements") @RequireActionPermissions("OPERATION_SETUP_MANAGE") recipeFixtureRequirement(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(createOperationFixtureRequirementSchema)) dto: any) { return this.service.createRecipeFixtureRequirement(u.tenantId, id, dto); }
  @Post("operations/:id/tool-requirements") @RequireActionPermissions("OPERATION_SETUP_MANAGE") operationToolRequirement(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(createOperationToolRequirementSchema)) dto: any) { return this.service.createOperationToolRequirement(u.tenantId, id, dto); }
  @Post("operations/:id/fixture-requirements") @RequireActionPermissions("OPERATION_SETUP_MANAGE") operationFixtureRequirement(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(createOperationFixtureRequirementSchema)) dto: any) { return this.service.createOperationFixtureRequirement(u.tenantId, id, dto); }
  @Get("operations/:id/setup") @RequireActionPermissions("TOOL_READ") setup(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.service.getSetup(u.tenantId, id); }
  @Post("operations/:id/setup/assignments") @RequireActionPermissions("OPERATION_SETUP_MANAGE") assign(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(setupAssignmentSchema)) dto: SetupAssignmentDto) { return this.service.assignSetup(u.tenantId, id, dto); }
  @Post("operations/:id/setup/verify") @RequireActionPermissions("OPERATION_SETUP_VERIFY") verify(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.service.verifySetup(u.tenantId, u.userId, id); }
  @Post("operations/:id/setup/invalidate") @RequireActionPermissions("OPERATION_SETUP_MANAGE") invalidate(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(invalidateSetupSchema)) dto: { reason: string }) { return this.service.invalidateSetup(u.tenantId, u.userId, id, dto.reason); }
}
