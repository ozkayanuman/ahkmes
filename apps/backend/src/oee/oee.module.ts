import { Module } from "@nestjs/common";
import { ProductionCalendarModule } from "../production-calendar/production-calendar.module";
import { OeeCalculationService } from "./oee-calculation.service";
import { OeeController } from "./oee.controller";
import { OeeService } from "./oee.service";
import { OeeSnapshotSynchronization } from "./oee-snapshot-synchronization";
import { ActionPermissionsModule } from "../action-permissions/action-permissions.module";
import { OeeCockpitService } from "./oee-cockpit.service";

@Module({
  imports: [ProductionCalendarModule, ActionPermissionsModule],
  controllers: [OeeController],
  providers: [OeeService, OeeCalculationService, OeeCockpitService, OeeSnapshotSynchronization],
  exports: [OeeService, OeeCalculationService],
})
export class OeeModule {}
