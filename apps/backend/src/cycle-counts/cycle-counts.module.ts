import { Module } from "@nestjs/common";
import { CycleCountsController } from "./cycle-counts.controller";
import { CycleCountsService } from "./cycle-counts.service";

@Module({
  controllers: [CycleCountsController],
  providers: [CycleCountsService],
})
export class CycleCountsModule {}
