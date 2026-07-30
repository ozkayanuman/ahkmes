import { Module } from "@nestjs/common";
import { QuotesController } from "./quotes.controller";
import { QuotesService } from "./quotes.service";
import { SalesOrdersModule } from "../sales-orders/sales-orders.module";

@Module({
  imports: [SalesOrdersModule],
  controllers: [QuotesController],
  providers: [QuotesService],
})
export class QuotesModule {}
