import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import type { CreateCapaDto, UpdateCapaDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { AuthService } from "../auth/auth.service";
import { nextDocNo } from "../common/numbering";
import { OutboxService } from "../outbox/outbox.service";

const CAPA_INCLUDE = {
  sourceNonConformance: { select: { id: true, failureType: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

type Decision = "approve" | "reject";

/** Düzeltici/Önleyici Faaliyet (CAPA) — onay akışı Faz A'nın genel
 * ApprovalRequest motoru üzerinden yürür. Motor hiçbir entity'yi otomatik
 * dönüştürmez (approvals.service.ts felsefesi) — CAPA kendi status'unu
 * burada senkronize eder (bkz. mrp.service.ts decidePurchaseProposal aynı
 * deseni kullanır). */
@Injectable()
export class CapaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly auth: AuthService,
    private readonly outbox: OutboxService,
  ) {}

  findAll(tenantId: string, status?: string) {
    return this.prisma.capa.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      include: CAPA_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const capa = await this.prisma.capa.findFirst({ where: { id, tenantId }, include: CAPA_INCLUDE });
    if (!capa) throw new NotFoundException("CAPA kaydı bulunamadı");
    return capa;
  }

  async create(tenantId: string, userId: string, dto: CreateCapaDto) {
    if (dto.sourceNonConformanceId) {
      const nc = await this.prisma.nonConformance.findFirst({
        where: { id: dto.sourceNonConformanceId, tenantId },
      });
      if (!nc) throw new NotFoundException("Uygunsuzluk kaydı bulunamadı");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const dofNo = await nextDocNo(tx, "capa", "dofNo", "DOF");
      const capa = await tx.capa.create({
        data: { ...dto, tenantId, dofNo, createdById: userId },
        include: CAPA_INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "capa", capa.id, "capa.updated", { id: capa.id });
      return capa;
    });
    return created;
  }

  async update(tenantId: string, id: string, dto: UpdateCapaDto) {
    const capa = await this.findOne(tenantId, id);
    if (capa.status !== "DRAFT") {
      throw new ConflictException("Sadece taslak (DRAFT) CAPA düzenlenebilir");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.capa.update({ where: { id }, data: dto, include: CAPA_INCLUDE });
      await this.outbox.record(tx, tenantId, "capa", id, "capa.updated", { id });
      return updated;
    });
    return updated;
  }

  async submitForApproval(tenantId: string, userId: string, id: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const capa = await tx.capa.findFirst({ where: { id, tenantId } });
      if (!capa) throw new NotFoundException("CAPA kaydı bulunamadı");
      if (capa.status !== "DRAFT") throw new ConflictException("Sadece taslak (DRAFT) CAPA onaya gönderilebilir");
      await this.approvals.request(tenantId, userId, {
        entity: "capa", entityId: id, requiredRoles: ["ADMIN"],
      }, tx);
      const result = await tx.capa.update({ where: { id }, data: { status: "PENDING_APPROVAL" }, include: CAPA_INCLUDE });
      await this.outbox.record(tx, tenantId, "capa", id, "capa.updated", { id, status: "PENDING_APPROVAL" });
      return result;
    });
    return updated;
  }

  async decide(
    tenantId: string,
    id: string,
    decidedById: string,
    decidedRole: Role,
    action: Decision,
    note: string | undefined,
    password: string,
  ) {
    // AHK-006: kalite kararı (CAPA onay/red) kritik — transaction dışında (bağımsız
    // bir DB kontrolü olduğu için) yeniden kimlik doğrulama zorunlu.
    const reauth = await this.auth.reauthenticate(tenantId, decidedById, password);
    const result = await this.prisma.$transaction(async (tx) => {
      const capa = await tx.capa.findFirst({ where: { id, tenantId } });
      if (!capa) throw new NotFoundException("CAPA kaydı bulunamadı");
      if (capa.status !== "PENDING_APPROVAL") throw new ConflictException("Sadece onay bekleyen CAPA karara bağlanabilir");
      const approvalReq = await tx.approvalRequest.findFirst({
        where: { tenantId, entity: "capa", entityId: id, status: "PENDING" }, orderBy: { createdAt: "desc" },
      });
      if (!approvalReq) throw new NotFoundException("Bekleyen onay talebi bulunamadı");
      const status: "REJECTED" | "APPROVED" = action === "reject" ? "REJECTED" : "APPROVED";
      await (action === "reject"
        ? this.approvals.reject(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth)
        : this.approvals.approve(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth));
      const updated = await tx.capa.update({ where: { id }, data: { status }, include: CAPA_INCLUDE });
      // AHK-009: emitToTenant burada DEĞİL — domain yazımıyla aynı transaction'da
      // outbox'a yazılır, OutboxDispatcherService onu ayrı bir worker'da en-az-
      // bir-kez tüketip emitToTenant'a çevirir. Process update'ten SONRA, socket
      // yayınından ÖNCE çökerse (eski davranışta olay sessizce kaybolurdu) event
      // satırı DB'de kalır ve dispatcher process yeniden başlayınca teslim eder.
      await this.outbox.record(tx, tenantId, "capa", id, "capa.updated", { id, status });
      return { updated, approvalReq, status };
    });
    await this.approvals.notifyDecision(tenantId, result.approvalReq, result.status, note);
    return result.updated;
  }

  async close(tenantId: string, id: string) {
    const capa = await this.findOne(tenantId, id);
    if (capa.status !== "APPROVED") {
      throw new ConflictException("Sadece onaylanmış (APPROVED) CAPA kapatılabilir");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.capa.update({
        where: { id },
        data: { status: "CLOSED", closedAt: new Date() },
        include: CAPA_INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "capa", id, "capa.updated", { id, status: "CLOSED" });
      return updated;
    });
    return updated;
  }
}
