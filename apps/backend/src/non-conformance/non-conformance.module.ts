import { Module } from "@nestjs/common";
import { NonConformanceController } from "./non-conformance.controller";
import { NonConformanceService } from "./non-conformance.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [NotificationsModule, ApprovalsModule, AuthModule],
  controllers: [NonConformanceController],
  providers: [NonConformanceService],
  exports: [NonConformanceService],
})
export class NonConformanceModule {}
