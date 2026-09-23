import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { OnboardingImportController } from "./onboarding-import.controller";
import { OnboardingImportService } from "./onboarding-import.service";

@Module({ imports: [InventoryModule], controllers: [OnboardingImportController], providers: [OnboardingImportService] })
export class OnboardingImportModule {}
