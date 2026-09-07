import { Module } from "@nestjs/common";
import { DigitalTwinController } from "./digital-twin.controller";
import { DigitalTwinService } from "./digital-twin.service";
import { OeeModule } from "../oee/oee.module";
import { ActionPermissionsModule } from "../action-permissions/action-permissions.module";

@Module({
  imports: [OeeModule, ActionPermissionsModule],
  controllers: [DigitalTwinController],
  providers: [DigitalTwinService],
})
export class DigitalTwinModule {}
