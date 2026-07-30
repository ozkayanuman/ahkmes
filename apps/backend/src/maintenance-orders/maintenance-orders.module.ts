import { Module } from "@nestjs/common";
import { MaintenanceOrdersController } from "./maintenance-orders.controller";
import { MaintenanceOrdersService } from "./maintenance-orders.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [MaintenanceOrdersController],
  providers: [MaintenanceOrdersService],
})
export class MaintenanceOrdersModule {}
