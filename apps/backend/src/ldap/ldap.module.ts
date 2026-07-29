import { Module } from "@nestjs/common";
import { LdapController } from "./ldap.controller";
import { LdapService } from "./ldap.service";

@Module({
  controllers: [LdapController],
  providers: [LdapService],
  exports: [LdapService],
})
export class LdapModule {}
