import { Module } from "@nestjs/common";
import { OidcProvidersController } from "./oidc-providers.controller";
import { OidcProvidersService } from "./oidc-providers.service";
import { OidcAuthController } from "./oidc-auth.controller";
import { OidcAuthService } from "./oidc-auth.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [OidcProvidersController, OidcAuthController],
  providers: [OidcProvidersService, OidcAuthService],
})
export class OidcModule {}
