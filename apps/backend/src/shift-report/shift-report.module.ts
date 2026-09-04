import { Module } from "@nestjs/common";
import { ShiftReportController } from "./shift-report.controller";
import { ShiftReportService } from "./shift-report.service";
import { OeeModule } from "../oee/oee.module";
import { ProductionCalendarModule } from "../production-calendar/production-calendar.module";

@Module({
  imports: [OeeModule, ProductionCalendarModule],
  controllers: [ShiftReportController],
  providers: [ShiftReportService],
})
export class ShiftReportModule {}
