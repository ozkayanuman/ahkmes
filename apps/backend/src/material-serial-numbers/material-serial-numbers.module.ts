import { Module } from "@nestjs/common";
import { MaterialSerialNumbersController } from "./material-serial-numbers.controller";
import { MaterialSerialNumbersService } from "./material-serial-numbers.service";
@Module({ controllers: [MaterialSerialNumbersController], providers: [MaterialSerialNumbersService] }) export class MaterialSerialNumbersModule {}
