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
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AppModule {}
