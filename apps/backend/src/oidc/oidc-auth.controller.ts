import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { OidcAuthService } from "./oidc-auth.service";

const NONCE_COOKIE = "oidc_nonce";

/** cookie-parser bağımlılığı eklemeden Cookie header'ını elle okur — burada
 * tek bir değere ihtiyaç var, genel bir cookie parser gerekmiyor. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Login sayfası + IdP callback'i için PUBLIC (kimlik doğrulaması gerekmez —
 * zaten kimlik doğrulamanın kendisi bu akış). ADMIN'in sağlayıcı YÖNETİMİ
 * (oluşturma/silme) ayrı ve korumalı OidcProvidersController'da. */
@Controller("auth/oidc")
export class OidcAuthController {
  constructor(
    private readonly service: OidcAuthService,
    private readonly config: ConfigService,
  ) {}

  @Get("providers")
  providers() {
    return this.service.publicProviders();
  }

  /** nonce'u HttpOnly cookie'ye yazar (login CSRF düzeltmesi — bkz.
   * OidcAuthService.signState yorumu): sadece bu isteği başlatan tarayıcı
   * callback'i tamamlayabilir. Secure bayrağı KENDİ sunucumuzun (PUBLIC_APP_URL)
   * şemasına göre ayarlanır — IdP'nin (authorize URL'i) şemasına göre DEĞİL.
   * İlk yazımda yanlışlıkla IdP URL'ine bakılıyordu; gerçek IdP'ler (Google
   * dahil) her zaman https olduğundan bu hep true dönüyordu — kendi sunucumuz
   * yerel/docker'da http çalışırken cookie'nin tarayıcıya HİÇ kaydedilmemesine
   * (ve tüm akışın kırılmasına) yol açacaktı; gerçek bir tarayıcı akışı
   * simülasyonuyla (curl cookie jar) yakalandı. */
  @Get(":id/authorize")
  async authorize(@Param("id") id: string, @Res() res: Response) {
    const { url, nonce } = await this.service.authorizeUrl(id);
    const appUrl = this.config.get<string>("PUBLIC_APP_URL") ?? "http://localhost:3000";
    res.cookie(NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: appUrl.startsWith("https"),
      maxAge: 10 * 60 * 1000,
      path: "/auth/oidc",
    });
    res.redirect(url);
  }

  /** IdP'nin geri yönlendirdiği uç — token'ları tarayıcıya query yerine URL
   * fragment (#) ile taşır: fragment sunucuya/erişim loglarına/referrer'a
   * gitmez, sadece tarayıcıda kalır (frontend oidc-callback.tsx okur). */
  @Get(":id/callback")
  async callback(
    @Param("id") id: string,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const webUrl = this.config.get<string>("PUBLIC_WEB_URL") ?? "http://localhost:8080";
    res.clearCookie(NONCE_COOKIE, { path: "/auth/oidc" });
    if (!code || !state) {
      return res.redirect(`${webUrl}/oidc-callback#error=${encodeURIComponent("Eksik code/state parametresi")}`);
    }
    try {
      const nonce = readCookie(req, NONCE_COOKIE);
      const tokens = await this.service.handleCallback(id, code, state, nonce);
      res.redirect(
        `${webUrl}/oidc-callback#accessToken=${encodeURIComponent(tokens.accessToken)}&refreshToken=${encodeURIComponent(tokens.refreshToken)}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "OIDC girişi başarısız";
      res.redirect(`${webUrl}/oidc-callback#error=${encodeURIComponent(msg)}`);
    }
  }
}
