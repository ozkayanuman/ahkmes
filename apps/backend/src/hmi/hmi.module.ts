import { Module } from "@nestjs/common";
import { ActionPermissionsModule } from "../action-permissions/action-permissions.module";
import { ProductionModule } from "../production/production.module";
import { ToolingModule } from "../tooling/tooling.module";
import { WorkOrdersModule } from "../work-orders/work-orders.module";
import { HmiController } from "./hmi.controller";
import { HmiService } from "./hmi.service";

@Module({
  imports: [ActionPermissionsModule, ProductionModule, ToolingModule, WorkOrdersModule],
  controllers: [HmiController],
  providers: [HmiService],
})
export class HmiModule {}
