import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import type { CreateNcProgramDto, CreateNcProgramRevisionDto, CreatePartDto, ElectronicSignatureDto, EngineeringStatusChangeDto, UpdatePartDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { MinioService } from "../documents/minio.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { AuthService } from "../auth/auth.service";
import { writeTransactionalAudit } from "../common/transactional-audit";

// G-kod dosyaları için MIME allowlist — istemcinin gönderdiği mimeType doğrudan
// güvenilmez (bkz. documents.service.ts'teki aynı gerekçe: stored XSS riski).
const ALLOWED_NC_MIME_TYPES = new Set(["text/plain", "application/octet-stream"]);

@Injectable()
export class PartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly approvals: ApprovalsService,
    private readonly auth: AuthService,
  ) {}

  findAll(tenantId: string, q?: string) {
    return this.prisma.part.findMany({
      where: {
        tenantId,
        ...(q
          ? {
              OR: [
                { partNo: { contains: q, mode: "insensitive" as const } },
                { name: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      include: { stock: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const part = await this.prisma.part.findFirst({
      where: { id, tenantId },
      include: { stock: true, ncPrograms: { orderBy: { version: "desc" } } },
    });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    return part;
  }

  async create(tenantId: string, dto: CreatePartDto) {
    try {
      return await this.prisma.part.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu parça no + revizyon zaten kayıtlı");
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdatePartDto) {
    const part = await this.findOne(tenantId, id);
    if (part.engineeringStatus !== "DRAFT") throw new ConflictException("Released, obsolete, or legacy part revisions cannot be changed; create a new revision");
    try {
      return await this.prisma.part.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu parça no + revizyon zaten kayıtlı");
      }
      throw e;
    }
  }

  async setEngineeringStatus(tenantId: string, userId: string, id: string, dto: EngineeringStatusChangeDto) {
    return this.prisma.$transaction(async (tx) => {
      const part = await tx.part.findFirst({ where: { id, tenantId } });
      if (!part) throw new NotFoundException("Part was not found");
      if (part.engineeringStatus === dto.status) return part;
      const updated = await tx.part.update({ where: { id }, data: { engineeringStatus: dto.status } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "part-engineering", entityId: id, action: "STATUS_CHANGE", before: { status: part.engineeringStatus }, after: { status: updated.engineeringStatus, partNo: part.partNo, revision: part.revision } });
      return updated;
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    try {
      return await this.prisma.part.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException("Parçaya bağlı kayıtlar var (teklif/iş emri), silinemez");
      }
      throw e;
    }
  }

  async addNcProgram(tenantId: string, userId: string, dto: CreateNcProgramDto) {
    await this.findOne(tenantId, dto.partId);
    const latest = await this.prisma.ncProgram.findFirst({
      where: { partId: dto.partId },
      orderBy: { version: "desc" },
    });
    return this.prisma.ncProgram.create({
      data: {
        ...dto,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        tenantId,
        version: (latest?.version ?? 0) + 1,
        createdById: userId,
      },
    });
  }

  listNcPrograms(tenantId: string, partId: string) {
    return this.prisma.ncProgram.findMany({
      where: { tenantId, partId },
      orderBy: { version: "desc" },
    });
  }

  private async findNcProgram(tenantId: string, id: string) {
    const program = await this.prisma.ncProgram.findFirst({ where: { id, tenantId } });
    if (!program) throw new NotFoundException("NC programı bulunamadı");
    return program;
  }

  /** G-kod dosyasını MinIO'ya yükler; mevcut versiyon kaydının dosya alanlarını doldurur/değiştirir. */
  async uploadNcProgramFile(
    tenantId: string,
    id: string,
    input: { fileName: string; mimeType: string; buffer: Buffer },
  ) {
    if (!ALLOWED_NC_MIME_TYPES.has(input.mimeType)) {
      throw new BadRequestException(`Desteklenmeyen dosya tipi: ${input.mimeType}`);
    }
    const program = await this.findNcProgram(tenantId, id);
    if (program.status !== "DRAFT") {
      throw new ConflictException("Yayın sürecindeki veya yayınlanmış NC programının içeriği değiştirilemez; yeni revizyon oluşturun");
    }
    const storageKey = `${tenantId}/nc-programs/${program.partId}/${program.id}-${input.fileName}`;
    await this.minio.putObject(storageKey, input.buffer, input.mimeType);
    const checksum = createHash("sha256").update(input.buffer).digest("hex");
    return this.prisma.ncProgram.update({
      where: { id: program.id },
      data: {
        fileName: input.fileName,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        checksum,
      },
    });
  }

  async getNcProgramFileUrl(tenantId: string, id: string) {
    const program = await this.findNcProgram(tenantId, id);
    if (!program.storageKey) throw new NotFoundException("Bu NC programı için henüz dosya yüklenmemiş");
    const url = await this.minio.presignedGetUrl(program.storageKey, program.fileName);
    return { url, fileName: program.fileName };
  }

  async createNcProgramRevision(tenantId: string, userId: string, id: string, dto: CreateNcProgramRevisionDto) {
    const source = await this.findNcProgram(tenantId, id);
    if (source.status === "DRAFT") throw new ConflictException("Taslak üzerinde doğrudan çalışın; yeni revizyon yalnızca kontrollü revizyondan açılır");
    const latest = await this.prisma.ncProgram.findFirst({ where: { tenantId, partId: source.partId }, orderBy: { version: "desc" } });
    try {
      return await this.prisma.ncProgram.create({
        data: {
          tenantId,
          partId: source.partId,
          version: (latest?.version ?? source.version) + 1,
          fileName: dto.fileName,
          fileRef: dto.fileRef,
          notes: dto.notes,
          effectivityScope: dto.effectivityScope ?? source.effectivityScope,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : source.effectiveFrom,
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : source.effectiveTo,
          parentRevisionId: source.id,
          createdById: userId,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException("NC revizyonu eşzamanlı oluşturuldu; listeyi yenileyip tekrar deneyin");
      throw e;
    }
  }

  async submitNcProgramForReview(tenantId: string, userId: string, id: string, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const program = await tx.ncProgram.findFirst({ where: { id, tenantId } });
      if (!program) throw new NotFoundException("NC programı bulunamadı");
      this.assertUploadReady(program);
      if (program.status !== "DRAFT") throw new ConflictException("Yalnızca taslak NC programı incelemeye gönderilebilir");
      const approval = await this.approvals.request(tenantId, userId, {
        entity: "nc-program",
        entityId: program.id,
        requiredRoles: [Role.ADMIN],
        note,
      }, tx);
      const updated = await tx.ncProgram.update({
        where: { id: program.id },
        data: { status: "REVIEW", submittedAt: new Date(), approvalRequestId: approval.id },
      });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "nc-program", entityId: id, action: "STATUS_CHANGE", before: { status: program.status }, after: { status: updated.status, approvalRequestId: approval.id, checksum: updated.checksum } });
      return updated;
    });
  }

  async approveNcProgram(tenantId: string, userId: string, role: Role, id: string, signature: ElectronicSignatureDto) {
    if (role !== Role.ADMIN) throw new ForbiddenException("NC onayı yalnızca ADMIN yetkisiyle verilebilir");
    const reauth = await this.auth.reauthenticate(tenantId, userId, signature.password);
    return this.prisma.$transaction(async (tx) => {
      const program = await tx.ncProgram.findFirst({ where: { id, tenantId } });
      if (!program) throw new NotFoundException("NC programı bulunamadı");
      this.assertUploadReady(program);
      if (program.status !== "REVIEW" || !program.approvalRequestId) throw new ConflictException("Yalnızca incelemedeki NC programı onaylanabilir");
      if (program.createdById === userId) throw new ForbiddenException("NC programını oluşturan kişi onaylayamaz");
      const approval = await this.approvals.approve(tenantId, program.approvalRequestId, userId, role, signature.note, tx, false);
      const updated = await tx.ncProgram.update({ where: { id: program.id }, data: { status: "APPROVED", approvedById: userId, approvedAt: new Date() } });
      await tx.ncProgramSignature.create({ data: { tenantId, ncProgramId: id, action: "APPROVE", signerId: userId, checksum: program.checksum, authSource: reauth.authSource } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "nc-program", entityId: id, action: "STATUS_CHANGE", before: { status: program.status, approvalStatus: "PENDING" }, after: { status: updated.status, approvalId: approval.id, checksum: updated.checksum, reauthenticatedAt: reauth.verifiedAt } });
      return updated;
    });
  }

  async publishNcProgram(tenantId: string, userId: string, role: Role, id: string, signature: ElectronicSignatureDto) {
    if (role !== Role.ADMIN && role !== Role.PLANNER) throw new ForbiddenException("NC yayını için yayın yetkisi gerekir");
    const reauth = await this.auth.reauthenticate(tenantId, userId, signature.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const program = await tx.ncProgram.findFirst({ where: { id, tenantId } });
        if (!program) throw new NotFoundException("NC programı bulunamadı");
        this.assertUploadReady(program);
        if (program.status !== "APPROVED") throw new ConflictException("Onaylanmamış NC programı yayınlanamaz");
        if (!program.approvedById || program.approvedById === userId || program.createdById === userId) {
          throw new ForbiddenException("Yayınlayan kişi oluşturucu veya onaylayan kişi olamaz");
        }
        if ((program.effectiveFrom && program.effectiveFrom > new Date()) || (program.effectiveTo && program.effectiveTo < new Date())) {
          throw new ConflictException("NC programı bugün için etkin değil");
        }
        // Serialize all releases of the same part/scope. Parent revision detects
        // stale concurrent candidates rather than silently superseding a new one.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${program.partId}:${program.effectivityScope}`}))`;
        const current = await tx.ncProgram.findFirst({ where: { tenantId, partId: program.partId, effectivityScope: program.effectivityScope, status: "PUBLISHED" } });
        if (current && current.id !== program.parentRevisionId) {
          throw new ConflictException("Bu kapsamda daha yeni bir NC revizyonu yayınlandı; tekrar inceleme gerekir");
        }
        if (current) await tx.ncProgram.update({ where: { id: current.id }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
        const updated = await tx.ncProgram.update({ where: { id: program.id }, data: { status: "PUBLISHED", publishedById: userId, publishedAt: new Date() } });
        await tx.ncProgramSignature.create({ data: { tenantId, ncProgramId: id, action: "PUBLISH", signerId: userId, checksum: program.checksum, authSource: reauth.authSource } });
        await writeTransactionalAudit(tx, { tenantId, userId, entity: "nc-program", entityId: id, action: "STATUS_CHANGE", before: { status: program.status, checksum: program.checksum }, after: { status: updated.status, checksum: updated.checksum, reauthenticatedAt: reauth.verifiedAt, supersededRevisionId: current?.id } });
        return updated;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException("Bu kapsamda yalnızca bir NC revizyonu yayınlanabilir");
      throw e;
    }
  }

  async archiveNcProgram(tenantId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const program = await tx.ncProgram.findFirst({ where: { id, tenantId } });
      if (!program) throw new NotFoundException("NC programı bulunamadı");
      if (program.status === "PUBLISHED") throw new ConflictException("Yayınlı NC programı doğrudan arşivlenemez; önce yeni revizyon yayınlayın");
      if (program.status === "ARCHIVED") throw new ConflictException("NC programı zaten arşivde");
      const updated = await tx.ncProgram.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "nc-program", entityId: id, action: "STATUS_CHANGE", before: { status: program.status }, after: { status: updated.status } });
      return updated;
    });
  }

  /** Shared policy used when a route is assigned and again immediately before HMI execution. */
  async assertNcProgramUsable(tenantId: string, ncProgramId: string, partId: string, machineId?: string | null, expectedChecksum?: string | null, client: PrismaService | Prisma.TransactionClient = this.prisma) {
    const program = await client.ncProgram.findFirst({ where: { id: ncProgramId, tenantId, partId } });
    if (!program) throw new NotFoundException("NC programı bu tenant/parça için bulunamadı");
    this.assertUploadReady(program);
    if (program.status !== "PUBLISHED") throw new ConflictException("Yalnızca yayınlanmış ve etkin NC programı üretimde kullanılabilir");
    const now = new Date();
    if ((program.effectiveFrom && program.effectiveFrom > now) || (program.effectiveTo && program.effectiveTo < now)) throw new ConflictException("NC programı etkinlik tarihi dışında");
    if (program.effectivityScope.startsWith("MACHINE:") && program.effectivityScope !== `MACHINE:${machineId ?? ""}`) throw new ConflictException("NC programı seçili tezgah kapsamı dışında");
    if (expectedChecksum && expectedChecksum !== program.checksum) throw new ConflictException("NC programı checksum'ı operasyon snapshot'ıyla uyuşmuyor");
    return program;
  }

  private assertUploadReady(program: { storageKey: string | null; sizeBytes: number | null; checksum: string; checksumAlgorithm: string }) {
    if (!program.storageKey || !program.sizeBytes || program.sizeBytes <= 0 || program.checksumAlgorithm !== "SHA-256" || !/^[a-f0-9]{64}$/i.test(program.checksum)) {
      throw new ConflictException("NC dosyası, boyutu veya SHA-256 checksum bilgisi geçerli değil");
    }
  }
}
