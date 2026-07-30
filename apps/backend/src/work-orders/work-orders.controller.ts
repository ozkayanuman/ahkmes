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
  createWorkOrderSchema,
  scheduleWorkOrderSchema,
  updateWorkOrderSchema,
  workOrderStatusUpdateSchema,
  type CreateWorkOrderDto,
  type ScheduleWorkOrderDto,
  type UpdateWorkOrderDto,
  type WorkOrderStatusUpdateDto,
} from "@ahkmes/shared-types";
import type { WorkOrderStatus } from "@prisma/client";
import { WorkOrdersService } from "./work-orders.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("work-orders")
@RequirePage("work-orders")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class WorkOrdersController {
  constructor(private readonly service: WorkOrdersService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: WorkOrderStatus,
    @Query("q") q?: string,
  ) {
    return this.service.findAll(user.tenantId, status, q);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Get(":id/oee")
  oee(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.oee(user.tenantId, id);
  }

  @Get(":id/cost")
  cost(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.cost(user.tenantId, id);
  }

  @Get(":id/genealogy")
  @RequirePage("genealogy")
  genealogy(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.genealogy(user.tenantId, id);
  }

  @Patch(":id/schedule")
  @Roles("ADMIN", "PLANNER")
  schedule(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(scheduleWorkOrderSchema)) dto: ScheduleWorkOrderDto,
  ) {
    return this.service.schedule(user.tenantId, id, dto);
  }

  @Post()
  @Roles("ADMIN", "PLANNER")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWorkOrderSchema)) dto: CreateWorkOrderDto,
  ) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "PLANNER")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWorkOrderSchema)) dto: UpdateWorkOrderDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Patch(":id/status")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(workOrderStatusUpdateSchema)) dto: WorkOrderStatusUpdateDto,
  ) {
    return this.service.setStatus(user.tenantId, id, dto.status);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
