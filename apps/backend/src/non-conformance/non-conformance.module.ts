import { Module } from "@nestjs/common";
import { NonConformanceController } from "./non-conformance.controller";
import { NonConformanceService } from "./non-conformance.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [NonConformanceController],
  providers: [NonConformanceService],
  exports: [NonConformanceService],
})
export class NonConformanceModule {}
