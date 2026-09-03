import { Module } from "@nestjs/common";
import { ProductionCalendarModule } from "../production-calendar/production-calendar.module";
import { OeeCalculationService } from "./oee-calculation.service";
import { OeeController } from "./oee.controller";
import { OeeService } from "./oee.service";
import { OeeSnapshotSynchronization } from "./oee-snapshot-synchronization";

@Module({
  imports: [ProductionCalendarModule],
  controllers: [OeeController],
  providers: [OeeService, OeeCalculationService, OeeSnapshotSynchronization],
  exports: [OeeService, OeeCalculationService],
})
export class OeeModule {}
