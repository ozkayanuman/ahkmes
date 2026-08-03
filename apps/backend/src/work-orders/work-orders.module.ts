import { Module } from "@nestjs/common";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrdersService } from "./work-orders.service";
import { PartsModule } from "../parts/parts.module";
import { ToolingModule } from "../tooling/tooling.module";

@Module({
  imports: [PartsModule, ToolingModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
