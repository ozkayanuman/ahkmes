import { Module } from "@nestjs/common";
import { ActionPermissionsModule } from "../action-permissions/action-permissions.module";
import { ProductionModule } from "../production/production.module";
import { ToolingModule } from "../tooling/tooling.module";
import { WorkOrdersModule } from "../work-orders/work-orders.module";
import { ProductionMaterialModule } from "../production-material/production-material.module";
import { QualityExecutionModule } from "../quality-execution/quality-execution.module";
import { ControllerVerificationModule } from "../controller-verification/controller-verification.module";
import { MachinesModule } from "../machines/machines.module";
import { MaintenanceOrdersModule } from "../maintenance-orders/maintenance-orders.module";
import { HmiController } from "./hmi.controller";
import { HmiService } from "./hmi.service";

@Module({
  imports: [ActionPermissionsModule, ProductionModule, ToolingModule, WorkOrdersModule, ProductionMaterialModule, QualityExecutionModule, ControllerVerificationModule, MachinesModule, MaintenanceOrdersModule],
  controllers: [HmiController],
  providers: [HmiService],
})
export class HmiModule {}
