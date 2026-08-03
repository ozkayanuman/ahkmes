import { Module } from "@nestjs/common";
import { QualityPlansController } from "./quality-plans.controller";
import { QualityPlansService } from "./quality-plans.service";
@Module({ controllers: [QualityPlansController], providers: [QualityPlansService] })
export class QualityPlansModule {}
