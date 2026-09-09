import { Module } from "@nestjs/common";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrdersService } from "./work-orders.service";
import { PartsModule } from "../parts/parts.module";
import { ToolingModule } from "../tooling/tooling.module";
import { ProductionMaterialModule } from "../production-material/production-material.module";
import { UomModule } from "../uom/uom.module";
import { QualityExecutionModule } from "../quality-execution/quality-execution.module";
import { OeeModule } from "../oee/oee.module";

@Module({
  imports: [PartsModule, ToolingModule, ProductionMaterialModule, UomModule, QualityExecutionModule, OeeModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
