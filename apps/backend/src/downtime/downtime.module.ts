import { Module } from "@nestjs/common";
import { DowntimeController } from "./downtime.controller";
import { DowntimeService } from "./downtime.service";
import { ActionPermissionsModule } from "../action-permissions/action-permissions.module";

@Module({
  imports: [ActionPermissionsModule],
  controllers: [DowntimeController],
  providers: [DowntimeService],
  exports: [DowntimeService],
})
export class DowntimeModule {}
