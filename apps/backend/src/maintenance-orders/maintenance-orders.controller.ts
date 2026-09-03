import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  addMaintenanceLaborSchema,
  addMaintenanceSpareSchema,
  addMaintenanceTaskSchema,
  assignMaintenanceTechnicianSchema,
  completeMaintenanceOrderSchema,
  completeMaintenanceTaskSchema,
  createMaintenanceCodeSchema,
  createMaintenanceOrderSchema,
  createMaintenancePlanSchema,
  createMaintenanceRequestSchema,
  declareMaintenanceBreakdownSchema,
  maintenanceSpareMovementSchema,
  returnToServiceSchema,
  type CompleteMaintenanceOrderDto,
  type CreateMaintenanceOrderDto,
  type CreateMaintenancePlanDto,
  type CreateMaintenanceRequestDto,
  type DeclareMaintenanceBreakdownDto,
} from "@ahkmes/shared-types";
import type { MaintenanceOrderStatus } from "@prisma/client";
import { z } from "zod";
import { ActionPermissionsGuard } from "../common/guards/action-permissions.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireActionPermissions } from "../common/decorators/require-action-permission.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { MaintenanceOrdersService } from "./maintenance-orders.service";

const commandSchema = z.object({ idempotencyKey: z.string().trim().min(8).max(160), note: z.string().max(2000).optional() });
const generateSchema = z.object({ asOf: z.coerce.date().optional() });

@Controller("maintenance-orders")
@RequirePage("maintenance-orders")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard, ActionPermissionsGuard)
export class MaintenanceOrdersController {
  constructor(private readonly service: MaintenanceOrdersService) {}

  @Get("workbench") @RequireActionPermissions("CMMS_READ")
  workbench(@CurrentUser() u: AuthUser, @Query() query: Record<string, string>) { return this.service.workbench(u.tenantId, query); }

  @Get("assets") @RequireActionPermissions("CMMS_READ")
  assets(@CurrentUser() u: AuthUser, @Query("plantId") plantId?: string) { return this.service.listAssets(u.tenantId, plantId); }

  @Get("assets/:id") @RequireActionPermissions("CMMS_READ")
  asset(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.service.assetDetail(u.tenantId, id); }

  @Post("assets/:id/return-to-service") @RequireActionPermissions("CMMS_RETURN_TO_SERVICE")
  returnToService(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(returnToServiceSchema)) dto: z.infer<typeof returnToServiceSchema>) { return this.service.returnToService(u.tenantId, u.userId, id, dto); }

  @Post("requests") @RequireActionPermissions("CMMS_REQUEST_CREATE")
  request(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createMaintenanceRequestSchema)) dto: CreateMaintenanceRequestDto) { return this.service.createRequest(u.tenantId, u.userId, dto); }

  @Post("breakdowns") @RequireActionPermissions("CMMS_BREAKDOWN_DECLARE")
  breakdown(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(declareMaintenanceBreakdownSchema)) dto: DeclareMaintenanceBreakdownDto) { return this.service.declareBreakdown(u.tenantId, u.userId, dto); }

  @Post("breakdowns/:id/convert") @RequireActionPermissions("CMMS_WO_PLAN")
  convert(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.service.convertBreakdown(u.tenantId, u.userId, id); }

  @Get("plans/due") @RequireActionPermissions("CMMS_READ")
  due(@CurrentUser() u: AuthUser, @Query("asOf") asOf?: string) { return this.service.duePlans(u.tenantId, asOf ? new Date(asOf) : new Date()); }

  @Post("plans") @RequireActionPermissions("CMMS_PM_ADMIN")
  plan(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createMaintenancePlanSchema)) dto: CreateMaintenancePlanDto) { return this.service.createPlan(u.tenantId, u.userId, dto); }

  @Post("plans/generate") @RequireActionPermissions("CMMS_PM_ADMIN")
  generate(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(generateSchema)) dto: z.infer<typeof generateSchema>) { return this.service.generateDue(u.tenantId, u.userId, dto.asOf ?? new Date()); }

  @Get("downtime-facts") @RequireActionPermissions("CMMS_READ")
  facts(@CurrentUser() u: AuthUser, @Query("machineId") machineId?: string, @Query("from") from?: string, @Query("to") to?: string) { return this.service.downtimeFacts(u.tenantId, machineId, from ? new Date(from) : undefined, to ? new Date(to) : undefined); }

  @Post("codes") @RequireActionPermissions("CMMS_CODE_ADMIN")
  code(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createMaintenanceCodeSchema)) dto: z.infer<typeof createMaintenanceCodeSchema>) { return this.service.createCode(u.tenantId, u.userId, dto); }

  @Get() @RequireActionPermissions("CMMS_READ")
  findAll(@CurrentUser() u: AuthUser, @Query("machineId") machineId?: string, @Query("status") status?: MaintenanceOrderStatus) { return this.service.findAll(u.tenantId, machineId, status); }

  @Post() @RequireActionPermissions("CMMS_WO_PLAN")
  create(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(createMaintenanceOrderSchema)) dto: CreateMaintenanceOrderDto) { return this.service.create(u.tenantId, u.userId, dto); }

  @Post("predictive-check") @RequireActionPermissions("CMMS_PM_ADMIN")
  predictive(@CurrentUser() u: AuthUser) { return this.service.predictiveCheck(u.tenantId, u.userId); }

  @Post(":id/release") @RequireActionPermissions("CMMS_WO_PLAN")
  release(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(commandSchema)) dto: z.infer<typeof commandSchema>) { return this.service.transition(u.tenantId, u.userId, id, "RELEASED", dto); }

  @Post(":id/start") @RequireActionPermissions("CMMS_WO_EXECUTE")
  start(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(commandSchema)) dto: z.infer<typeof commandSchema>) { return this.service.transition(u.tenantId, u.userId, id, "IN_PROGRESS", dto); }

  @Post(":id/hold") @RequireActionPermissions("CMMS_WO_EXECUTE")
  hold(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(commandSchema)) dto: z.infer<typeof commandSchema>) { return this.service.transition(u.tenantId, u.userId, id, "ON_HOLD", dto); }

  @Post(":id/resume") @RequireActionPermissions("CMMS_WO_EXECUTE")
  resume(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(commandSchema)) dto: z.infer<typeof commandSchema>) { return this.service.transition(u.tenantId, u.userId, id, "IN_PROGRESS", dto); }

  @Post(":id/cancel") @RequireActionPermissions("CMMS_WO_PLAN")
  cancel(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(commandSchema)) dto: z.infer<typeof commandSchema>) { return this.service.transition(u.tenantId, u.userId, id, "CANCELLED", dto); }

  @Post(":id/complete") @RequireActionPermissions("CMMS_WO_EXECUTE")
  complete(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(completeMaintenanceOrderSchema)) dto: CompleteMaintenanceOrderDto) { return this.service.complete(u.tenantId, u.userId, id, dto); }

  @Post(":id/assignments") @RequireActionPermissions("CMMS_ASSIGN_TECHNICIAN")
  assign(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(assignMaintenanceTechnicianSchema)) dto: z.infer<typeof assignMaintenanceTechnicianSchema>) { return this.service.assignTechnician(u.tenantId, u.userId, id, dto); }

  @Post(":id/tasks") @RequireActionPermissions("CMMS_WO_PLAN")
  task(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(addMaintenanceTaskSchema)) dto: z.infer<typeof addMaintenanceTaskSchema>) { return this.service.addTask(u.tenantId, u.userId, id, dto); }

  @Post(":id/tasks/:taskId/complete") @RequireActionPermissions("CMMS_WO_EXECUTE")
  taskComplete(@CurrentUser() u: AuthUser, @Param("id") id: string, @Param("taskId") taskId: string, @Body(new ZodValidationPipe(completeMaintenanceTaskSchema)) dto: z.infer<typeof completeMaintenanceTaskSchema>) { return this.service.completeTask(u.tenantId, u.userId, id, taskId, dto.completed); }

  @Post(":id/labor") @RequireActionPermissions("CMMS_WO_EXECUTE")
  labor(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(addMaintenanceLaborSchema)) dto: z.infer<typeof addMaintenanceLaborSchema>) { return this.service.addLabor(u.tenantId, u.userId, id, dto); }

  @Post(":id/spares") @RequireActionPermissions("CMMS_WO_PLAN")
  spare(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(addMaintenanceSpareSchema)) dto: z.infer<typeof addMaintenanceSpareSchema>) { return this.service.addSpare(u.tenantId, u.userId, id, dto); }

  @Post(":id/spares/:lineId/issue") @RequireActionPermissions("CMMS_SPARE_ISSUE")
  issue(@CurrentUser() u: AuthUser, @Param("id") id: string, @Param("lineId") lineId: string, @Body(new ZodValidationPipe(maintenanceSpareMovementSchema)) dto: z.infer<typeof maintenanceSpareMovementSchema>) { return this.service.issueSpare(u.tenantId, u.userId, id, lineId, dto); }

  @Post(":id/spares/:lineId/return") @RequireActionPermissions("CMMS_SPARE_ISSUE")
  returnSpare(@CurrentUser() u: AuthUser, @Param("id") id: string, @Param("lineId") lineId: string, @Body(new ZodValidationPipe(maintenanceSpareMovementSchema)) dto: z.infer<typeof maintenanceSpareMovementSchema>) { return this.service.returnSpare(u.tenantId, u.userId, id, lineId, dto); }

  @Get(":id") @RequireActionPermissions("CMMS_READ")
  findOne(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.service.findOne(u.tenantId, id); }
}
