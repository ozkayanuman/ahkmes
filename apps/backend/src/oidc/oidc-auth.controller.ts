import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { OidcAuthService } from "./oidc-auth.service";

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

  @Get(":id/authorize")
  async authorize(@Param("id") id: string, @Res() res: Response) {
    const url = await this.service.authorizeUrl(id);
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
    @Res() res: Response,
  ) {
    const webUrl = this.config.get<string>("PUBLIC_WEB_URL") ?? "http://localhost:8080";
    if (!code || !state) {
      return res.redirect(`${webUrl}/oidc-callback#error=${encodeURIComponent("Eksik code/state parametresi")}`);
    }
    try {
      const tokens = await this.service.handleCallback(id, code, state);
      res.redirect(
        `${webUrl}/oidc-callback#accessToken=${encodeURIComponent(tokens.accessToken)}&refreshToken=${encodeURIComponent(tokens.refreshToken)}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "OIDC girişi başarısız";
      res.redirect(`${webUrl}/oidc-callback#error=${encodeURIComponent(msg)}`);
    }
  }
}
