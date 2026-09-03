import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createInspectionLotSchema, createQualityDispositionSchema, qualityReleaseSchema, submitInspectionMeasurementSchema, type CreateInspectionLotDto, type CreateQualityDispositionDto, type QualityReleaseDto, type SubmitInspectionMeasurementDto } from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { QualityExecutionService } from "./quality-execution.service";

@Controller("quality-execution") @RequirePage("inspections") @UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class QualityExecutionController {
  constructor(private readonly service: QualityExecutionService) {}
  @Get("requirements") requirements(@CurrentUser() user: AuthUser) { return this.service.requirements(user.tenantId); }
  @Get("lots") lots(@CurrentUser() user: AuthUser, @Query("workOrderId") workOrderId?: string) { return this.service.lots(user.tenantId, workOrderId); }
  @Post("lots") @Roles("ADMIN", "PLANNER", "FOREMAN", "OPERATOR") createLot(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createInspectionLotSchema)) dto: CreateInspectionLotDto) { return this.service.createLot(user.tenantId, user.userId, dto); }
  @Post("lots/:id/measurements") @Roles("ADMIN", "PLANNER", "FOREMAN", "OPERATOR") measure(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(submitInspectionMeasurementSchema)) dto: SubmitInspectionMeasurementDto) { return this.service.submitMeasurement(user.tenantId, user.userId, id, dto); }
  @Post("ncr/:id/dispositions") @Roles("ADMIN", "PLANNER", "FOREMAN") disposition(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(createQualityDispositionSchema)) dto: CreateQualityDispositionDto) { return this.service.disposition(user.tenantId, user.userId, id, dto, user.role === "ADMIN"); }
  @Post("holds/:id/release") @Roles("ADMIN", "PLANNER", "FOREMAN") release(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(qualityReleaseSchema)) dto: QualityReleaseDto) { return this.service.release(user.tenantId, user.userId, id, dto); }
}
