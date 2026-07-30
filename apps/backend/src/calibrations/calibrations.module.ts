import { Module } from "@nestjs/common";
import { CalibrationsController } from "./calibrations.controller";
import { CalibrationsService } from "./calibrations.service";

@Module({
  controllers: [CalibrationsController],
  providers: [CalibrationsService],
})
export class CalibrationsModule {}
