import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { DocumentEntityType, DocumentType } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { MinioService } from "./minio.service";

interface UploadInput {
  entityType: DocumentEntityType;
  entityId: string;
  docType: DocumentType;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

// İstemcinin gönderdiği mimeType doğrudan güvenilmez (stored XSS riski,
// ör. text/html, image/svg+xml); yalnızca beklenen doküman tipleri kabul edilir.
const ALLOWED_MIME_TYPES = new Set([
  "application/step",
  "application/x-step",
  "model/step",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/octet-stream",
]);

// Tarayıcının doğrudan (iframe/img ile) satır içi render edebileceği, XSS riski
// taşımayan tipler — belge önizleyicisi bu tipler için inline signed URL ister.
// STEP dosyaları tarayıcı tarafından native render edilmediği (occt-import-js
// fetch() ile ham veriyi kendi işler) için bu listeye girmesine gerek yok.
const INLINE_PREVIEWABLE_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  list(tenantId: string, entityType: DocumentEntityType, entityId: string) {
    return this.prisma.document.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: "desc" },
    });
  }

  async upload(tenantId: string, userId: string, input: UploadInput) {
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new BadRequestException(`Desteklenmeyen dosya tipi: ${input.mimeType}`);
    }
    const storageKey = `${tenantId}/${input.entityType}/${input.entityId}/${randomUUID()}-${input.fileName}`;
    await this.minio.putObject(storageKey, input.buffer, input.mimeType);
    return this.prisma.document.create({
      data: {
        tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        docType: input.docType,
        fileName: input.fileName,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        uploadedById: userId,
      },
    });
  }

  private async findOwned(tenantId: string, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException("Doküman bulunamadı");
    return doc;
  }

  async getSignedUrl(tenantId: string, id: string, mode?: "preview") {
    const doc = await this.findOwned(tenantId, id);
    const inlineMimeType =
      mode === "preview" && INLINE_PREVIEWABLE_MIME_TYPES.has(doc.mimeType) ? doc.mimeType : undefined;
    const url = await this.minio.presignedGetUrl(doc.storageKey, doc.fileName, 3600, inlineMimeType);
    return { url, fileName: doc.fileName, mimeType: doc.mimeType };
  }

  async remove(tenantId: string, id: string) {
    const doc = await this.findOwned(tenantId, id);
    await this.minio.removeObject(doc.storageKey);
    return this.prisma.document.delete({ where: { id: doc.id } });
  }
}
