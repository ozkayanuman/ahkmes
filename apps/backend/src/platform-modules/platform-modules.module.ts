import { Module } from "@nestjs/common";
import { PlatformModulesController } from "./platform-modules.controller";
import { PlatformModulesService } from "./platform-modules.service";
@Module({ controllers: [PlatformModulesController], providers: [PlatformModulesService] })
export class PlatformModulesModule {}
