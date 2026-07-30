import { Module } from "@nestjs/common";
import { LaborController } from "./labor.controller";
import { LaborService } from "./labor.service";

@Module({
  controllers: [LaborController],
  providers: [LaborService],
})
export class LaborModule {}
