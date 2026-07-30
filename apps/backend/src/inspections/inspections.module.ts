import { Module } from "@nestjs/common";
import { InspectionsController } from "./inspections.controller";
import { InspectionsService } from "./inspections.service";
import { NonConformanceModule } from "../non-conformance/non-conformance.module";

@Module({
  imports: [NonConformanceModule],
  controllers: [InspectionsController],
  providers: [InspectionsService],
})
export class InspectionsModule {}
