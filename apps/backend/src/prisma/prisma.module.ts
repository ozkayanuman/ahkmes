import { Global, Module } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { createTenantScopeExtension } from "./tenant-scope.extension";

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: async () => {
        const client = new PrismaClient();
        await client.$connect();
        const extended = client.$extends(createTenantScopeExtension());
        // Nest'in OnModuleDestroy algılaması düz property lookup'a dayanır —
        // extended client'ta özel yaşam döngüsü metodu olmadığı için burada
        // manuel ekleniyor (bkz. prisma.service.ts'teki not).
        Object.defineProperty(extended, "onModuleDestroy", {
          value: async () => {
            await client.$disconnect();
          },
        });
        return extended as unknown as PrismaService;
      },
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
