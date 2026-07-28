import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client } from "minio";

@Injectable()
export class MinioService implements OnModuleInit {
  readonly client: Client;
  readonly bucket: string;
  private readonly publicEndpoint: string;
  private readonly publicPort: number;
  private readonly useSSL: boolean;
  private readonly accessKey: string;
  private readonly secretKey: string;

  constructor(private readonly config: ConfigService) {
    this.useSSL = this.config.get<string>("MINIO_USE_SSL") === "true";
    this.bucket = this.config.get<string>("MINIO_BUCKET", "ahkmes-documents");
    this.publicEndpoint = this.config.get<string>("MINIO_PUBLIC_ENDPOINT", "localhost");
    this.publicPort = Number(this.config.get<string>("MINIO_PUBLIC_PORT", "9000"));
    this.accessKey = this.config.getOrThrow<string>("MINIO_ROOT_USER");
    this.secretKey = this.config.getOrThrow<string>("MINIO_ROOT_PASSWORD");

    this.client = new Client({
      endPoint: this.config.get<string>("MINIO_ENDPOINT", "localhost"),
      port: Number(this.config.get<string>("MINIO_PORT", "9000")),
      useSSL: this.useSSL,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      region: "us-east-1",
    });
  }

  async onModuleInit() {
    const exists = await this.client.bucketExists(this.bucket).catch(() => false);
    if (!exists) await this.client.makeBucket(this.bucket);
  }

  putObject(storageKey: string, buffer: Buffer, mimeType: string) {
    return this.client.putObject(this.bucket, storageKey, buffer, buffer.length, {
      "Content-Type": mimeType,
    });
  }

  removeObject(storageKey: string) {
    return this.client.removeObject(this.bucket, storageKey);
  }

  // Tarayıcıdan erişilebilir signed URL için ayrı bir public client kullanılır
  // (backend konteyner içi adres 'minio', dışarıdan erişim 'localhost' vb.)
  // Varsayılan: response-content-disposition: attachment + octet-stream zorlanır —
  // istemcinin yüklediği mimeType satır içi render edilirse (ör. text/html,
  // image/svg+xml) stored XSS'e yol açabileceğinden tarayıcı her zaman indirmeye
  // zorlanır, dosya içeriği asla doğrudan render edilmez.
  // inlineMimeType SADECE DocumentsService'in çağırdığı yerde zaten allowlist'te
  // doğrulanmış (application/pdf, image/png, image/jpeg) bir mimeType ile
  // geçilirse inline render'a izin verir — belge önizleyicisi (PDF/görsel) için.
  presignedGetUrl(storageKey: string, fileName: string, expirySeconds = 3600, inlineMimeType?: string) {
    const publicClient = new Client({
      endPoint: this.publicEndpoint,
      port: this.publicPort,
      useSSL: this.useSSL,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      region: "us-east-1",
    });
    const safeName = fileName.replace(/["\r\n]/g, "_");
    const disposition = inlineMimeType ? "inline" : "attachment";
    return publicClient.presignedGetObject(this.bucket, storageKey, expirySeconds, {
      "response-content-disposition": `${disposition}; filename="${safeName}"`,
      "response-content-type": inlineMimeType ?? "application/octet-stream",
    });
  }
}
