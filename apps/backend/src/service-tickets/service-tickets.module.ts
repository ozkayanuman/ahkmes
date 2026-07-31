import { Module } from "@nestjs/common";
import { ServiceTicketsController } from "./service-tickets.controller";
import { ServiceTicketsService } from "./service-tickets.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [ServiceTicketsController],
  providers: [ServiceTicketsService],
})
export class ServiceTicketsModule {}
