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
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AppModule {}
