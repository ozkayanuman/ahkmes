import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

// Tenant context artık TenantContextInterceptor'da kuruluyor (bkz.
// common/interceptors/tenant-context.interceptor.ts) — bu guard sadece JWT'yi
// doğrulayıp req.user'ı set eder, interceptor onu okur.
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
