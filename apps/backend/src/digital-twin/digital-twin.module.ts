import { Module } from "@nestjs/common";
import { DigitalTwinController } from "./digital-twin.controller";
import { DigitalTwinService } from "./digital-twin.service";

@Module({
  controllers: [DigitalTwinController],
  providers: [DigitalTwinService],
})
export class DigitalTwinModule {}
