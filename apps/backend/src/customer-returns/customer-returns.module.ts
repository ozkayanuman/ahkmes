import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { CustomerReturnsController } from "./customer-returns.controller";
import { CustomerReturnsService } from "./customer-returns.service";

@Module({ imports: [InventoryModule], controllers: [CustomerReturnsController], providers: [CustomerReturnsService] })
export class CustomerReturnsModule {}
