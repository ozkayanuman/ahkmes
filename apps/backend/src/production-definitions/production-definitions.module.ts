import { Module } from "@nestjs/common";
import { ProductionDefinitionsController } from "./production-definitions.controller";
import { ProductionDefinitionsService } from "./production-definitions.service";
@Module({ controllers: [ProductionDefinitionsController], providers: [ProductionDefinitionsService], exports: [ProductionDefinitionsService] })
export class ProductionDefinitionsModule {}
