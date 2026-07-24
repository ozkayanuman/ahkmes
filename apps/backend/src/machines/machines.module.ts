import { Module } from "@nestjs/common";
import { MachinesController, MachineTelemetryController } from "./machines.controller";
import { MachinesService } from "./machines.service";
import { MachineKeyGuard } from "../common/guards/machine-key.guard";

@Module({
  controllers: [MachinesController, MachineTelemetryController],
  providers: [MachinesService, MachineKeyGuard],
})
export class MachinesModule {}
