import { Module } from "@nestjs/common";
import { UomController } from "./uom.controller";
import { UomService } from "./uom.service";
@Module({ controllers: [UomController], providers: [UomService], exports: [UomService] })
export class UomModule {}
