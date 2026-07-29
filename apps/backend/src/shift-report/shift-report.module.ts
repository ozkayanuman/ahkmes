import { Module } from "@nestjs/common";
import { ShiftReportController } from "./shift-report.controller";
import { ShiftReportService } from "./shift-report.service";

@Module({
  controllers: [ShiftReportController],
  providers: [ShiftReportService],
})
export class ShiftReportModule {}
