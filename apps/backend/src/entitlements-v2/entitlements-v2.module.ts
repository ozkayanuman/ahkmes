import { Module } from "@nestjs/common";
import { EntitlementsV2Service } from "./entitlements-v2.service";
import { CommercialMigrationService } from "./commercial-migration.service";
import { ShadowEntitlementEvaluatorService } from "./shadow-entitlement-evaluator.service";

@Module({
  providers: [EntitlementsV2Service, CommercialMigrationService, ShadowEntitlementEvaluatorService],
  exports: [EntitlementsV2Service, CommercialMigrationService, ShadowEntitlementEvaluatorService],
})
export class EntitlementsV2Module {}
