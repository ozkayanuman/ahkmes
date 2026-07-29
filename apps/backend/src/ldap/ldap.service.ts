import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client } from "ldapts";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { LdapConfigDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AppException } from "../common/app-exception";
import { decryptSecret, encryptSecret } from "../common/crypto";

function firstValue(v: string | string[] | Buffer | Buffer[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.length > 0 ? String(v[0]) : undefined;
  return String(v);
}

@Injectable()
export class LdapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private secretKey() {
    return this.config.getOrThrow<string>("JWT_SECRET");
  }

  private clientUrl(host: string, port: number, useTls: boolean) {
    return `${useTls ? "ldaps" : "ldap"}://${host}:${port}`;
  }

  /** Şifre hariç, ekranda gösterilebilecek yapılandırma. */
  async getConfig(tenantId: string) {
    const row = await this.prisma.ldapConfig.findUnique({ where: { tenantId } });
    if (!row) return null;
    const { bindPasswordEnc: _bindPasswordEnc, ...rest } = row;
    return { ...rest, configured: true };
  }

  async upsertConfig(tenantId: string, dto: LdapConfigDto) {
    const bindPasswordEnc = encryptSecret(dto.bindPassword, this.secretKey());
    await this.prisma.ldapConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        host: dto.host,
        port: dto.port,
        useTls: dto.useTls,
        bindDn: dto.bindDn,
        bindPasswordEnc,
        baseDn: dto.baseDn,
        userFilter: dto.userFilter,
        attrEmail: dto.attrEmail,
        attrName: dto.attrName,
        defaultRole: dto.defaultRole,
      },
      update: {
        host: dto.host,
        port: dto.port,
        useTls: dto.useTls,
        bindDn: dto.bindDn,
        bindPasswordEnc,
        baseDn: dto.baseDn,
        userFilter: dto.userFilter,
        attrEmail: dto.attrEmail,
        attrName: dto.attrName,
        defaultRole: dto.defaultRole,
      },
    });
    return this.getConfig(tenantId);
  }

  /** Kaydedilmiş yapılandırmayı (şifre çözülmüş) döner — sadece dahili kullanım. */
  private async getRawConfig(tenantId: string) {
    const row = await this.prisma.ldapConfig.findUnique({ where: { tenantId } });
    if (!row) throw new NotFoundException("LDAP yapılandırması tanımlı değil");
    return { ...row, bindPassword: decryptSecret(row.bindPasswordEnc, this.secretKey()) };
  }

  /** LDAP RFC 4513 gereği boş şifreyle bind çoğu sunucuda "unauthenticated bind"
   * olarak başarıyla döner — bu, gerçek şifre bilinmeden kimlik doğrulanmış gibi
   * görünmesine (auth bypass) yol açar. Her bind çağrısından önce reddedilir. */
  private assertNonEmptyPassword(password: string) {
    if (!password || password.trim().length === 0) {
      throw new AppException(HttpStatus.BAD_REQUEST, "LDAP_EMPTY_PASSWORD", "Şifre boş olamaz");
    }
  }

  /** Verilen (henüz kaydedilmemiş olabilecek) yapılandırmayla servis hesabı bağlantısını dener. */
  async testConnection(dto: LdapConfigDto) {
    this.assertNonEmptyPassword(dto.bindPassword);
    const client = new Client({ url: this.clientUrl(dto.host, dto.port, dto.useTls), connectTimeout: 5000 });
    try {
      await client.bind(dto.bindDn, dto.bindPassword);
      return { ok: true };
    } catch (err) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "LDAP_CONNECTION_FAILED",
        err instanceof Error ? err.message : "LDAP sunucusuna bağlanılamadı",
      );
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /** Kayıtlı yapılandırmayla dizini tarar, kullanıcıları (email eşleşmesiyle) içe aktarır.
   * Zaten LOCAL (yerel şifreli) bir kullanıcıyla e-posta çakışması varsa dokunulmaz —
   * yerel bir hesabın kimlik doğrulama yöntemini sessizce LDAP'a çevirmek istemiyoruz. */
  async syncUsers(tenantId: string) {
    const cfg = await this.getRawConfig(tenantId);
    this.assertNonEmptyPassword(cfg.bindPassword);
    const client = new Client({ url: this.clientUrl(cfg.host, cfg.port, cfg.useTls), connectTimeout: 5000 });
    let created = 0;
    let updated = 0;
    let skipped = 0;
    try {
      await client.bind(cfg.bindDn, cfg.bindPassword);
      const { searchEntries } = await client.search(cfg.baseDn, {
        scope: "sub",
        filter: cfg.userFilter,
        attributes: [cfg.attrEmail, cfg.attrName],
      });

      for (const entry of searchEntries) {
        const email = firstValue(entry[cfg.attrEmail])?.toLowerCase();
        const name = firstValue(entry[cfg.attrName]) ?? email;
        if (!email) {
          skipped++;
          continue;
        }
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) {
          if (existing.authSource !== "LDAP") {
            skipped++;
            continue;
          }
          await this.prisma.user.update({
            where: { id: existing.id },
            data: { name: name ?? existing.name, externalDn: entry.dn },
          });
          updated++;
        } else {
          const unusablePassword = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
          await this.prisma.user.create({
            data: {
              tenantId,
              email,
              name: name ?? email,
              role: cfg.defaultRole,
              passwordHash: unusablePassword,
              authSource: "LDAP",
              externalDn: entry.dn,
            },
          });
          created++;
        }
      }
    } finally {
      await client.unbind().catch(() => undefined);
    }
    return { created, updated, skipped, total: created + updated + skipped };
  }

  /** LDAP kullanıcısının şifresini fabrikanın kendi AD sunucusuna bind ederek doğrular
   * — şifre hiçbir zaman burada saklanmaz/karşılaştırılmaz, otorite her zaman AD'dir. */
  async verifyCredentials(tenantId: string, externalDn: string, password: string): Promise<boolean> {
    if (!password || password.trim().length === 0) return false;
    const cfg = await this.getRawConfig(tenantId);
    const client = new Client({ url: this.clientUrl(cfg.host, cfg.port, cfg.useTls), connectTimeout: 5000 });
    try {
      await client.bind(externalDn, password);
      return true;
    } catch {
      return false;
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}
