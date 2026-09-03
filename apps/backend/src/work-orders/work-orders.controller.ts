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
  completeWorkOrderOperationSchema,
  scheduleWorkOrderSchema,
  updateWorkOrderOperationSchema,
  updateWorkOrderSchema,
  workOrderStatusUpdateSchema,
  type CreateWorkOrderDto,
  type CompleteWorkOrderOperationDto,
  type ScheduleWorkOrderDto,
  type UpdateWorkOrderDto,
  type UpdateWorkOrderOperationDto,
  type WorkOrderStatusUpdateDto,
  releaseWorkOrderEngineeringSchema,
  type ReleaseWorkOrderEngineeringDto,
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
import { parseOeeCalculationContext } from "../oee/oee-request";

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

  @Get(":id/operations")
  operations(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOperations(user.tenantId, id);
  }

  @Patch(":id/operations/:operationId")
  @Roles("ADMIN", "PLANNER", "FOREMAN")
  updateOperation(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("operationId") operationId: string,
    @Body(new ZodValidationPipe(updateWorkOrderOperationSchema)) dto: UpdateWorkOrderOperationDto,
  ) {
    return this.service.updateOperation(user.tenantId, id, operationId, dto);
  }

  @Post(":id/operations/:operationId/complete")
  @Roles("ADMIN", "PLANNER", "FOREMAN", "OPERATOR")
  completeOperation(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("operationId") operationId: string,
    @Body(new ZodValidationPipe(completeWorkOrderOperationSchema)) dto: CompleteWorkOrderOperationDto,
  ) {
    return this.service.completeOperation(user.tenantId, id, operationId, dto, user.userId);
  }

  @Get(":id/oee")
  oee(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("plantId") plantId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("asOf") asOf?: string,
  ) {
    return this.service.oee(user.tenantId, id, parseOeeCalculationContext(plantId, from, to, asOf));
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

  @Post(":id/release-engineering")
  @Roles("ADMIN", "PLANNER")
  releaseEngineering(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(releaseWorkOrderEngineeringSchema)) dto: ReleaseWorkOrderEngineeringDto) { return this.service.releaseEngineering(user.tenantId, user.userId, id, dto); }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
