import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { OutboxModule } from "../outbox/outbox.module";
import { QualityExecutionController } from "./quality-execution.controller";
import { QualityExecutionService } from "./quality-execution.service";

@Module({ imports: [InventoryModule, OutboxModule], controllers: [QualityExecutionController], providers: [QualityExecutionService], exports: [QualityExecutionService] })
export class QualityExecutionModule {}
