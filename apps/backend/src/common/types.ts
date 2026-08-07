import type { Role, UserAuthSource } from "@ahkmes/shared-types";

/** Kullanıcının hangi sayfaları görebildiği — rol gruplarının (PermissionGroup)
 * birleşimi. Hiçbir gruba üye değilse "*" (kısıtlamasız, geriye dönük uyumlu). */
export type UserPages = "*" | string[];

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  pages: UserPages;
  locale: string;
  timezone: string;
  authSource: UserAuthSource;
  oidcProviderId: string | null;
}

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  pages: UserPages;
  locale: string;
  timezone: string;
  authSource: UserAuthSource;
  oidcProviderId: string | null;
}
