import { Module } from "@nestjs/common";
import { ProductionController } from "./production.controller";
import { ProductionService } from "./production.service";
import { NonConformanceModule } from "../non-conformance/non-conformance.module";
import { PartsModule } from "../parts/parts.module";
import { ToolingModule } from "../tooling/tooling.module";

@Module({
  imports: [NonConformanceModule, PartsModule, ToolingModule],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
