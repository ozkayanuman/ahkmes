import { Module } from "@nestjs/common";
import { ProductionCalendarController } from "./production-calendar.controller";
import { ProductionCalendarService } from "./production-calendar.service";
@Module({ controllers: [ProductionCalendarController], providers: [ProductionCalendarService], exports: [ProductionCalendarService] })
export class ProductionCalendarModule {}
