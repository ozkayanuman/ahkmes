import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantStore {
  tenantId?: string;
}

/**
 * İstek başına tenant bağlamı. `TenantContextInterceptor` (bkz.
 * common/interceptors/tenant-context.interceptor.ts) her HTTP isteğinde
 * req.user/req.machine'den tenantId'yi okuyup burayı doldurur (login/refresh/
 * machine-key gibi kimlik henüz bilinmeyen adımlar bilerek boş kalır —
 * PrismaService extension'ı boş context'te sorguyu değiştirmeden geçirir).
 */
export const tenantAls = new AsyncLocalStorage<TenantStore>();

export function getTenantId(): string | undefined {
  return tenantAls.getStore()?.tenantId;
}

/**
 * HTTP isteği dışı yollar (test, seed, script, cron) için — bir bloğu belirli
 * bir tenant bağlamında çalıştırır. `fn` MUTLAKA kendi içinde await etmeli
 * (`async () => await ...`, `() => promise` DEĞİL): Prisma'nın sorgu
 * promise'leri lazy'dir, sadece `.then()`/`await` edildiklerinde çalışırlar —
 * senkron döndürülüp dışarıda await edilirse tenant context çoktan kapanmış
 * olur ve sorgu context'siz çalışır. Bu yüzden burada da bilerek `await`
 * ediliyor, çağıranın unutmasına güvenmiyoruz.
 */
export async function runWithTenant<T>(tenantId: string, fn: () => T | Promise<T>): Promise<T> {
  return tenantAls.run({ tenantId }, async () => await fn());
}
