import { Module } from "@nestjs/common";
import { NonConformanceController } from "./non-conformance.controller";
import { NonConformanceService } from "./non-conformance.service";

@Module({
  controllers: [NonConformanceController],
  providers: [NonConformanceService],
  exports: [NonConformanceService],
})
export class NonConformanceModule {}
