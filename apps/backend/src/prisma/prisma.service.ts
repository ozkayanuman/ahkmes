import { PrismaClient } from "@prisma/client";

/**
 * Sadece DI token/tip olarak kullanılır — hiç `new PrismaService()` ile
 * örneklenmez. Gerçek örnek (tenant-scope extension'lı) `PrismaModule`'deki
 * factory provider'da üretilir (bkz. prisma.module.ts): Prisma'nın
 * `$extends()` çıktısı, model delegate'lerini non-enumerable getter olarak
 * tanımladığı için `Object.assign(this, this.$extends(...))` ile bu sınıfın
 * kendi instance'ına "yamanamaz" (denenip PostgreSQL e2e'de sızıntı olarak
 * yakalandı) — bu yüzden extension, sınıfı örneklemek yerine factory'nin
 * döndürdüğü extended client'ın kendisi DI'a veriliyor.
 */
export class PrismaService extends PrismaClient {}
