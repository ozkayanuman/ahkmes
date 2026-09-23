import { Module } from "@nestjs/common";
import { ActionPermissionsModule } from "../action-permissions/action-permissions.module";
import { CostingController } from "./costing.controller";
import { CostingService } from "./costing.service";

@Module({ imports: [ActionPermissionsModule], controllers: [CostingController], providers: [CostingService], exports: [CostingService] })
export class CostingModule {}
