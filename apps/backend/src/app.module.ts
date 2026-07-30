import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { AuditInterceptor } from "./common/audit.interceptor";
import { UsersModule } from "./users/users.module";
import { CustomersModule } from "./customers/customers.module";
import { PartsModule } from "./parts/parts.module";
import { SuppliersModule } from "./suppliers/suppliers.module";
import { MaterialsModule } from "./materials/materials.module";
import { MachinesModule } from "./machines/machines.module";
import { QuotesModule } from "./quotes/quotes.module";
import { WorkOrdersModule } from "./work-orders/work-orders.module";
import { PurchasingModule } from "./purchasing/purchasing.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { ConsumptionModule } from "./consumption/consumption.module";
import { ProductionModule } from "./production/production.module";
import { FinishedGoodsModule } from "./finished-goods/finished-goods.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DocumentsModule } from "./documents/documents.module";
import { NonConformanceModule } from "./non-conformance/non-conformance.module";
import { HierarchyModule } from "./hierarchy/hierarchy.module";
import { DigitalTwinModule } from "./digital-twin/digital-twin.module";
import { OeeModule } from "./oee/oee.module";
import { AuditLogModule } from "./audit-log/audit-log.module";
import { ShiftReportModule } from "./shift-report/shift-report.module";
import { PermissionGroupsModule } from "./permission-groups/permission-groups.module";
import { LdapModule } from "./ldap/ldap.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ApprovalsModule } from "./approvals/approvals.module";
import { MrpModule } from "./mrp/mrp.module";
import { RfqModule } from "./rfq/rfq.module";
import { SalesOrdersModule } from "./sales-orders/sales-orders.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CustomersModule,
    PartsModule,
    SuppliersModule,
    MaterialsModule,
    MachinesModule,
    RealtimeModule,
    QuotesModule,
    WorkOrdersModule,
    PurchasingModule,
    ConsumptionModule,
    ProductionModule,
    FinishedGoodsModule,
    DashboardModule,
    DocumentsModule,
    NonConformanceModule,
    HierarchyModule,
    DigitalTwinModule,
    OeeModule,
    AuditLogModule,
    ShiftReportModule,
    PermissionGroupsModule,
    LdapModule,
    NotificationsModule,
    ApprovalsModule,
    MrpModule,
    RfqModule,
    SalesOrdersModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AppModule {}
