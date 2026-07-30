import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import type { CreateCapaDto, UpdateCapaDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { ApprovalsService } from "../approvals/approvals.service";
import { nextDocNo } from "../common/numbering";

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
    private readonly realtime: RealtimeGateway,
    private readonly approvals: ApprovalsService,
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
      return tx.capa.create({
        data: { ...dto, tenantId, dofNo, createdById: userId },
        include: CAPA_INCLUDE,
      });
    });
    this.realtime.emitToTenant(tenantId, "capa.updated", { id: created.id });
    return created;
  }

  async update(tenantId: string, id: string, dto: UpdateCapaDto) {
    const capa = await this.findOne(tenantId, id);
    if (capa.status !== "DRAFT") {
      throw new ConflictException("Sadece taslak (DRAFT) CAPA düzenlenebilir");
    }
    const updated = await this.prisma.capa.update({ where: { id }, data: dto, include: CAPA_INCLUDE });
    this.realtime.emitToTenant(tenantId, "capa.updated", { id });
    return updated;
  }

  async submitForApproval(tenantId: string, userId: string, id: string) {
    const capa = await this.findOne(tenantId, id);
    if (capa.status !== "DRAFT") {
      throw new ConflictException("Sadece taslak (DRAFT) CAPA onaya gönderilebilir");
    }
    await this.approvals.request(tenantId, userId, {
      entity: "capa",
      entityId: id,
      requiredRoles: ["ADMIN"],
    });
    const updated = await this.prisma.capa.update({
      where: { id },
      data: { status: "PENDING_APPROVAL" },
      include: CAPA_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "capa.updated", { id, status: "PENDING_APPROVAL" });
    return updated;
  }

  async decide(
    tenantId: string,
    id: string,
    decidedById: string,
    decidedRole: Role,
    action: Decision,
    note?: string,
  ) {
    const capa = await this.findOne(tenantId, id);
    if (capa.status !== "PENDING_APPROVAL") {
      throw new ConflictException("Sadece onay bekleyen CAPA karara bağlanabilir");
    }
    const approvalReq = await this.prisma.approvalRequest.findFirst({
      where: { tenantId, entity: "capa", entityId: id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (!approvalReq) throw new NotFoundException("Bekleyen onay talebi bulunamadı");

    if (action === "reject") {
      await this.approvals.reject(tenantId, approvalReq.id, decidedById, decidedRole, note);
      const updated = await this.prisma.capa.update({
        where: { id },
        data: { status: "REJECTED" },
        include: CAPA_INCLUDE,
      });
      this.realtime.emitToTenant(tenantId, "capa.updated", { id, status: "REJECTED" });
      return updated;
    }

    await this.approvals.approve(tenantId, approvalReq.id, decidedById, decidedRole, note);
    const updated = await this.prisma.capa.update({
      where: { id },
      data: { status: "APPROVED" },
      include: CAPA_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "capa.updated", { id, status: "APPROVED" });
    return updated;
  }

  async close(tenantId: string, id: string) {
    const capa = await this.findOne(tenantId, id);
    if (capa.status !== "APPROVED") {
      throw new ConflictException("Sadece onaylanmış (APPROVED) CAPA kapatılabilir");
    }
    const updated = await this.prisma.capa.update({
      where: { id },
      data: { status: "CLOSED", closedAt: new Date() },
      include: CAPA_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "capa.updated", { id, status: "CLOSED" });
    return updated;
  }
}
