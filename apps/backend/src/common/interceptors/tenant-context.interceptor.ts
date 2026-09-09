import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { tenantAls } from "../tenant-context";
import type { AuthUser } from "../types";

/**
 * Tenant context'i kurar — AppModule'de EN DIŞTAKİ (ilk sıradaki) global
 * interceptor olmalı, çünkü tenant-scope Prisma extension'ının (ve
 * AuditInterceptor'ın kendi audit yazımının) doğru çalışması buna bağlı.
 *
 * NEDEN interceptor, middleware/guard değil: Express middleware guard'lardan
 * ÖNCE çalıştığı için req.user henüz yok. Daha kritiği — `next.handle()` bir
 * RxJS Observable'dır ve LAZY'dir: sadece `next.handle()` çağrısını
 * `tenantAls.run()` içine almak YETMEZ, çünkü asıl controller/servis
 * çalışması `.subscribe()` anında tetiklenir ve subscribe genelde
 * `als.run()`'ın senkron penceresi kapandıktan SONRA gerçekleşir (Prisma'nın
 * kendi PrismaPromise'ları da aynı nedenle lazy'dir — ikisi birleşince context
 * sessizce kayboluyordu, gerçek PostgreSQL e2e'de cross-tenant sızıntı olarak
 * yakalandı). Çözüm: SUBSCRIBE çağrısının kendisini `als.run()` içine almak.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    const tenantId: string | undefined = user?.tenantId ?? req.machine?.tenantId;

    return new Observable((subscriber) => {
      tenantAls.run({ tenantId }, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
