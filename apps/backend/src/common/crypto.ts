import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** LDAP bind şifresi gibi geri döndürülebilir olması gereken sırlar için simetrik
 * şifreleme (AES-256-GCM). Ayrı bir env değişkeni yönetmemek için anahtar, zaten
 * zorunlu olan JWT_SECRET'tan türetilir (SHA-256 ile 32 byte'a indirgenir). */
function deriveKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(encoded: string, secret: string): string {
  const key = deriveKey(secret);
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
