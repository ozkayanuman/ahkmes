import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { OeeModule } from "../oee/oee.module";

@Module({
  imports: [OeeModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
