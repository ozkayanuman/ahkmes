import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { jwtVerify } from "jose";
import type { LoginDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionGroupsService } from "../permission-groups/permission-groups.service";
import { LdapService } from "../ldap/ldap.service";
import type { JwtPayload, UserPages } from "../common/types";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly permissionGroups: PermissionGroupsService,
    private readonly ldap: LdapService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("E-posta veya şifre hatalı");
    }

    if (user.authSource === "OIDC") {
      // OIDC kullanıcıları local /auth/login ile hiç giriş yapamaz — sadece
      // /auth/oidc/:id/authorize akışı üzerinden. Önceki halde bu dal yoktu
      // ve authSource==="OIDC" sessizce bcrypt.compare dalına düşüyordu.
      throw new UnauthorizedException("Bu kullanıcı sadece SSO/OIDC ile giriş yapabilir");
    } else if (user.authSource === "LDAP") {
      if (!user.externalDn) {
        throw new UnauthorizedException("LDAP kullanıcısının dizin kaydı bulunamadı, tekrar içe aktarın");
      }
      const ok = await this.ldap.verifyCredentials(user.tenantId, user.externalDn, dto.password);
      if (!ok) throw new UnauthorizedException("E-posta veya şifre hatalı");
    } else if (!(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("E-posta veya şifre hatalı");
    }

    return this.issueTokens(
      user.id,
      user.email,
      user.name,
      user.role,
      user.tenantId,
      user.locale,
      user.timezone,
      user.authSource,
      user.oidcProviderId,
    );
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException("Geçersiz yenileme token'ı");
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (
      !user ||
      !user.isActive ||
      !user.refreshTokenHash ||
      !(await bcrypt.compare(refreshToken, user.refreshTokenHash))
    ) {
      throw new UnauthorizedException("Geçersiz yenileme token'ı");
    }
    return this.issueTokens(
      user.id,
      user.email,
      user.name,
      user.role,
      user.tenantId,
      user.locale,
      user.timezone,
      user.authSource,
      user.oidcProviderId,
    );
  }

  /**
   * AHK-006 focused reauthentication boundary for critical electronic signatures.
   * It verifies the active user's primary identity without issuing a new session
   * and returns only non-secret evidence that can be recorded with the signature.
   */
  async reauthenticate(tenantId: string, userId: string, password: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId, isActive: true } });
    if (!user) throw new UnauthorizedException("Oturum kullanıcısı bulunamadı");
    let valid = false;
    if (user.authSource === "LOCAL") valid = await bcrypt.compare(password, user.passwordHash);
    else if (user.authSource === "LDAP" && user.externalDn) {
      valid = await this.ldap.verifyCredentials(tenantId, user.externalDn, password);
    } else if (user.authSource === "OIDC") {
      // AHK-006 kalanı: OIDC kullanıcıları için "şifre" alanı, IdP'nin
      // `prompt=login` akışını (OidcAuthService.handleReauthCallback) tamamlayınca
      // dönen kısa ömürlü (2dk) imzalı reauth kanıtını taşır — düz metin şifre
      // DEĞİLDİR. `sub`/`purpose` eşleşmesi bu kullanıcı için, bu amaçla, yakın
      // zamanda üretilmiş olduğunu garanti eder (bkz. oidc-auth.service.ts).
      valid = await this.verifyOidcReauthEvidence(userId, password);
    }
    if (!valid) throw new UnauthorizedException("Elektronik imza için yeniden kimlik doğrulama başarısız");
    return { userId: user.id, authSource: user.authSource, verifiedAt: new Date() };
  }

  private async verifyOidcReauthEvidence(userId: string, token: string): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(this.config.getOrThrow<string>("JWT_SECRET")));
      return payload.purpose === "reauth" && payload.sub === userId && payload.authSource === "OIDC";
    } catch {
      return false;
    }
  }

  /** Kendi kendine dil/saat dilimi güncelleme — ADMIN yetkisi gerekmez, herhangi
   * bir kullanıcı kendi tercihini değiştirebilir (Faz P i18n). */
  async updateProfile(userId: string, dto: { locale?: string; timezone?: string }) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: dto });
    return this.issueTokens(
      user.id,
      user.email,
      user.name,
      user.role,
      user.tenantId,
      user.locale,
      user.timezone,
      user.authSource,
      user.oidcProviderId,
    );
  }

  async issueTokens(
    sub: string,
    email: string,
    name: string,
    role: string,
    tenantId: string,
    locale: string,
    timezone: string,
    authSource: "LOCAL" | "LDAP" | "OIDC",
    oidcProviderId: string | null,
  ) {
    const pages: UserPages = await this.permissionGroups.computeUserPages(sub);
    const payload = { sub, email, name, role, tenantId, pages, locale, timezone, authSource, oidcProviderId };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.get("JWT_ACCESS_TTL") ?? "15m",
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.get("JWT_REFRESH_TTL") ?? "7d",
    });
    await this.prisma.user.update({
      where: { id: sub },
      data: { refreshTokenHash: await bcrypt.hash(refreshToken, 10) },
    });
    return { accessToken, refreshToken };
  }
}
