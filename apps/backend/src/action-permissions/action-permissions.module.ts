import { Module } from "@nestjs/common";
import { ActionPermissionsController } from "./action-permissions.controller";
import { ActionPermissionsService } from "./action-permissions.service";
import { ActionPermissionsGuard } from "../common/guards/action-permissions.guard";
@Module({ controllers: [ActionPermissionsController], providers: [ActionPermissionsService, ActionPermissionsGuard], exports: [ActionPermissionsService, ActionPermissionsGuard] })
export class ActionPermissionsModule {}
