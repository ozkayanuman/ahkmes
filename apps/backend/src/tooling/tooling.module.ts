import { Module } from "@nestjs/common";
import { ToolingController } from "./tooling.controller";
import { ToolingService } from "./tooling.service";
import { PartsModule } from "../parts/parts.module";
import { ActionPermissionsModule } from "../action-permissions/action-permissions.module";
import { FixtureMaintenanceModule } from "../fixture-maintenance/fixture-maintenance.module";

@Module({ imports: [PartsModule, ActionPermissionsModule, FixtureMaintenanceModule], controllers: [ToolingController], providers: [ToolingService], exports: [ToolingService] })
export class ToolingModule {}
