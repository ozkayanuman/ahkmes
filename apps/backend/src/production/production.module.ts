import { Module } from "@nestjs/common";
import { ProductionController } from "./production.controller";
import { ProductionService } from "./production.service";
import { NonConformanceModule } from "../non-conformance/non-conformance.module";

@Module({
  imports: [NonConformanceModule],
  controllers: [ProductionController],
  providers: [ProductionService],
})
export class ProductionModule {}
