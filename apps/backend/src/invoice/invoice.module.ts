import { Module } from "@nestjs/common";
import { GlModule } from "../gl/gl.module";
import { InvoiceController } from "./invoice.controller";
import { InvoiceService } from "./invoice.service";

@Module({
  imports: [GlModule],
  controllers: [InvoiceController],
  providers: [InvoiceService],
})
export class InvoiceModule {}
