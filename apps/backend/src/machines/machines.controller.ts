import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  assignActiveWorkOrderSchema,
  createMachineSchema,
  createMachineTagSchema,
  machineTagValuesSchema,
  machineTelemetrySchema,
  updateMachineSchema,
  updateMachineTagSchema,
  type AssignActiveWorkOrderDto,
  type CreateMachineDto,
  type CreateMachineTagDto,
  type MachineTagValuesDto,
  type MachineTelemetryDto,
  type UpdateMachineDto,
  type UpdateMachineTagDto,
} from "@ahkmes/shared-types";
import type { Machine } from "@prisma/client";
import { MachinesService } from "./machines.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { MachineKeyGuard } from "../common/guards/machine-key.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CurrentMachine } from "../common/decorators/current-machine.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("machines")
@RequirePage("machines", "automation-gateway")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class MachinesController {
  constructor(private readonly service: MachinesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @Roles("ADMIN")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createMachineSchema)) dto: CreateMachineDto,
  ) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateMachineSchema)) dto: UpdateMachineDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Patch(":id/active-work-order")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  assignActiveWorkOrder(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(assignActiveWorkOrderSchema)) dto: AssignActiveWorkOrderDto,
  ) {
    return this.service.assignActiveWorkOrder(user.tenantId, id, dto.workOrderId);
  }

  @Post(":id/connector-key")
  @Roles("ADMIN", "PLANNER")
  generateConnectorKey(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.generateConnectorKey(user.tenantId, id);
  }

  // ---- Automation Gateway: Machine Tag CRUD (Faz 1) ----

  @Get(":id/tags")
  listTags(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.listTags(user.tenantId, id);
  }

  @Post(":id/tags")
  @Roles("ADMIN")
  createTag(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createMachineTagSchema)) dto: CreateMachineTagDto,
  ) {
    return this.service.createTag(user.tenantId, id, dto);
  }

  @Patch(":id/tags/:tagId")
  @Roles("ADMIN")
  updateTag(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("tagId") tagId: string,
    @Body(new ZodValidationPipe(updateMachineTagSchema)) dto: UpdateMachineTagDto,
  ) {
    return this.service.updateTag(user.tenantId, id, tagId, dto);
  }

  @Delete(":id/tags/:tagId")
  @Roles("ADMIN")
  removeTag(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("tagId") tagId: string) {
    return this.service.removeTag(user.tenantId, id, tagId);
  }
}

// JWT'siz, makineye özel X-Machine-Key ile korunur — connector süreçleri kullanır.
@Controller("machines")
@UseGuards(MachineKeyGuard)
export class MachineTelemetryController {
  constructor(private readonly service: MachinesService) {}

  @Post(":id/telemetry")
  telemetry(
    @CurrentMachine() machine: Machine,
    @Body(new ZodValidationPipe(machineTelemetrySchema)) dto: MachineTelemetryDto,
  ) {
    return this.service.handleTelemetry(machine, dto);
  }

  @Post(":id/tag-values")
  tagValues(
    @CurrentMachine() machine: Machine,
    @Body(new ZodValidationPipe(machineTagValuesSchema)) dto: MachineTagValuesDto,
  ) {
    return this.service.handleTagValues(machine, dto);
  }

  /** Connector'ın başlangıçta kendi bağlantı ayarlarını (web'de configure edilen) çekmesi için. */
  @Get(":id/connector-config")
  connectorConfig(@CurrentMachine() machine: Machine) {
    return { connectorType: machine.connectorType, connectorConfig: machine.connectorConfig };
  }
}
