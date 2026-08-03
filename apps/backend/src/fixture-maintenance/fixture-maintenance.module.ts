import { Module } from "@nestjs/common";
import { ActionPermissionsModule } from "../action-permissions/action-permissions.module";
import { FixtureMaintenanceController } from "./fixture-maintenance.controller";
import { FixtureMaintenanceService } from "./fixture-maintenance.service";
@Module({ imports: [ActionPermissionsModule], controllers: [FixtureMaintenanceController], providers: [FixtureMaintenanceService], exports: [FixtureMaintenanceService] })
export class FixtureMaintenanceModule {}
