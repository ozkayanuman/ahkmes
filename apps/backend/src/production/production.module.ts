import { Module } from "@nestjs/common";
import { ProductionController } from "./production.controller";
import { ProductionService } from "./production.service";
import { NonConformanceModule } from "../non-conformance/non-conformance.module";
import { PartsModule } from "../parts/parts.module";
import { ToolingModule } from "../tooling/tooling.module";
import { ProductionMaterialModule } from "../production-material/production-material.module";
import { QualityExecutionModule } from "../quality-execution/quality-execution.module";
import { ProductionCalendarModule } from "../production-calendar/production-calendar.module";
import { ControllerVerificationModule } from "../controller-verification/controller-verification.module";
import { MachinesModule } from "../machines/machines.module";

@Module({
  imports: [NonConformanceModule, PartsModule, ToolingModule, ProductionMaterialModule, QualityExecutionModule, ProductionCalendarModule, ControllerVerificationModule, MachinesModule],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
