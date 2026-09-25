import { Module } from "@nestjs/common";
import { ProductionCalendarModule } from "../production-calendar/production-calendar.module";
import { SchedulingController } from "./scheduling.controller";
import { SchedulingService } from "./scheduling.service";

@Module({
  imports: [ProductionCalendarModule],
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
