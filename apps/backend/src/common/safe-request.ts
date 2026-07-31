import { BadRequestException } from "@nestjs/common";
import { isIPv4, isIPv6 } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/**
 * webhooks.service.ts'nin SSRF-koruma çekirdeği (DNS/IP doğrulama) buraya
 * taşındı — OIDC discovery/JWKS/token exchange istekleri de dış URL'lere
 * (ADMIN tarafından girilen issuer) gidiyor ve aynı sınıf riski taşıyor
 * (bkz. Faz J: "ADMIN-only endpoint'ler bile yaygın SSRF hedefi"). İstek
 * YÜRÜTME kısmı (pinnedFetch) webhooks.service.ts'in kendi pinnedRequest'inden
 * BİLİNÇLİ OLARAK AYRI tutuldu — webhook'un fire-and-forget/POST-only/ok-only
 * deseni OIDC'nin ihtiyacına (GET/POST + response body okuma) uymuyor, ve
 * zaten iki tur güvenlik denetiminden geçmiş çalışan kodu gereksiz yere
 * değiştirmemek için dokunulmadı.
 */

function ipv4ToInt(ip: string): number | null {
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  let result = 0;
  for (const o of octets) {
    if (!/^\d{1,3}$/.test(o)) return null;
    const n = Number(o);
    if (n > 255) return null;
    result = (result << 8) + n;
  }
  return result >>> 0;
}

function inCidr(ipInt: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  return (
    inCidr(n, "10.0.0.0", 8) ||
    inCidr(n, "172.16.0.0", 12) ||
    inCidr(n, "192.168.0.0", 16) ||
    inCidr(n, "127.0.0.0", 8) ||
    inCidr(n, "169.254.0.0", 16) ||
    n === 0
  );
}

export function isPrivateIp(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIpv4(ip);
  if (isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    return false;
  }
  return true;
}

export function assertPublicUrl(url: string, label = "URL") {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException(`Geçersiz ${label}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequestException(`${label} http(s) olmalı`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const isLiteralIp = isIPv4(hostname) || isIPv6(hostname);
  if (hostname.toLowerCase() === "localhost" || (isLiteralIp && isPrivateIp(hostname))) {
    throw new BadRequestException(`${label} yerel/özel ağ adresine işaret edemez`);
  }
}

/** Hostname'i tek sefer çözüp doğrulanmış bir IP döndürür (TOCTOU'ya karşı —
 * bkz. webhooks.service.ts'deki aynı isimli fonksiyonun yorumu). */
export async function resolveSafeIp(hostname: string): Promise<string | null> {
  const clean = hostname.replace(/^\[|\]$/g, "");
  if (isIPv4(clean) || isIPv6(clean)) return isPrivateIp(clean) ? null : clean;
  try {
    const results = await lookup(clean, { all: true });
    if (results.length === 0 || results.some((r) => isPrivateIp(r.address))) return null;
    return results[0].address;
  } catch {
    return null;
  }
}

export interface PinnedFetchResult {
  status: number;
  body: string;
}

/** GET/POST için pinlenmiş (önceden çözülmüş IP'ye doğrudan bağlanan)
 * istek — webhooks.service.ts'in aksine yanıt gövdesini okur ve döner
 * (discovery doc/JWKS/token exchange yanıtları işlenmesi gerektiğinden). */
export function pinnedFetch(
  targetUrl: string,
  ip: string,
  options: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs?: number },
): Promise<PinnedFetchResult> {
  const parsed = new URL(targetUrl);
  const isHttps = parsed.protocol === "https:";
  const requester = isHttps ? httpsRequest : httpRequest;
  const timeoutMs = options.timeoutMs ?? 10_000;

  return new Promise((resolve, reject) => {
    const req = requester(
      {
        hostname: ip,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method,
        headers: { ...options.headers, Host: parsed.host },
        ...(isHttps ? { servername: parsed.hostname } : {}),
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("İstek zaman aşımına uğradı")));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

/** assertPublicUrl + resolveSafeIp + pinnedFetch'i tek adımda birleştirir —
 * OIDC discovery/JWKS/token exchange'in üçü de bu yardımcıyı kullanır.
 * Yönlendirme (3xx) TAKİP EDİLMEZ — redirect-tabanlı SSRF bypass'ı önler. */
export async function safeFetch(
  url: string,
  options: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs?: number },
  label = "URL",
): Promise<PinnedFetchResult> {
  assertPublicUrl(url, label);
  const hostname = new URL(url).hostname;
  const ip = await resolveSafeIp(hostname);
  if (!ip) throw new BadRequestException(`${label} çözülemedi veya yerel/özel bir adrese işaret ediyor`);
  const result = await pinnedFetch(url, ip, options);
  if (result.status >= 300 && result.status < 400) {
    throw new BadRequestException(`${label} yönlendirme (redirect) döndürdü, izin verilmiyor`);
  }
  return result;
}
