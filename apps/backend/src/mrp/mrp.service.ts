import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { PurchasingService } from "../purchasing/purchasing.service";
import { WorkOrdersService } from "../work-orders/work-orders.service";
import { AuthService } from "../auth/auth.service";
import { nextDocNo } from "../common/numbering";

const PP_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  lines: {
    include: { material: { select: { id: true, code: true, name: true, unit: true, stockQty: true } } },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

const PRP_INCLUDE = {
  part: { select: { id: true, partNo: true, name: true } },
} as const;

type Decision = "approve" | "reject";

/**
 * MRP netleme motoru (Faz B): açık WorkOrder talebi + Material.minStock
 * reorder-point'i demand kaynağı olarak alır, aktif BomHeader üzerinden
 * tek seviye patlatma yapar, mevcut stok + açık PO + zaten üretilmiş
 * DRAFT/PENDING_APPROVAL öneriler'e karşı netler. Netleme formülü:
 * Net = (Gross İhtiyaç + Safety Stock) − Eldeki Stok − Açık Sipariş − Zaten Önerilmiş.
 *
 * Materyaller Supplier'a bağlı olmadığından (mevcut şemada Material↔Supplier
 * ilişkisi yok) tüm shortfall'lar tek bir "tedarikçisiz" PurchaseProposal'da
 * toplanır — onay anında gerçek tedarikçi seçilir (bkz. decidePurchaseProposal).
 */
@Injectable()
export class MrpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly approvals: ApprovalsService,
    private readonly purchasing: PurchasingService,
    private readonly workOrders: WorkOrdersService,
    private readonly auth: AuthService,
    private readonly outbox: OutboxService,
  ) {}

  /** MRP II için kapasite girdilerinin gerçek durumunu gösterir. Mevcut modelde
   * operasyon süreleri ve vardiya takvimi olmadığı için finite schedule üretmez;
   * bunun yerine hangi makine/operasyon verisinin eksik olduğunu görünür kılar. */
  async capacityReadiness(tenantId: string) {
    const [machines, operations] = await Promise.all([
      this.prisma.machine.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.workOrderOperation.findMany({
        where: {
          tenantId,
          status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
          workOrder: { status: { in: ["PLANNED", "WAITING_MATERIAL", "IN_PRODUCTION"] } },
        },
        select: {
          id: true,
          name: true,
          seq: true,
          status: true,
          machineId: true,
          workOrder: { select: { id: true, woNo: true, dueDate: true, priority: true } },
        },
        orderBy: [{ workOrder: { dueDate: "asc" } }, { seq: "asc" }],
      }),
    ]);

    const byMachine = new Map<string, { operationCount: number; blockedCount: number; workOrderIds: Set<string>; earliestDueDate: Date | null }>();
    const unassignedOperations: { id: string; name: string; seq: number; status: string; workOrder: { id: string; woNo: string; dueDate: Date; priority: number } }[] = [];
    for (const operation of operations) {
      if (!operation.machineId) {
        unassignedOperations.push(operation);
        continue;
      }
      const current = byMachine.get(operation.machineId) ?? {
        operationCount: 0,
        blockedCount: 0,
        workOrderIds: new Set<string>(),
        earliestDueDate: null,
      };
      current.operationCount += 1;
      current.blockedCount += operation.status === "BLOCKED" ? 1 : 0;
      current.workOrderIds.add(operation.workOrder.id);
      if (!current.earliestDueDate || operation.workOrder.dueDate < current.earliestDueDate) {
        current.earliestDueDate = operation.workOrder.dueDate;
      }
      byMachine.set(operation.machineId, current);
    }

    return {
      readyForFiniteScheduling: false,
      reason: "Operasyon standart süreleri ve makine vardiya/kapasite takvimi tanımlı değil.",
      summary: {
        activeMachineCount: machines.length,
        activeOperationCount: operations.length,
        assignedOperationCount: operations.length - unassignedOperations.length,
        unassignedOperationCount: unassignedOperations.length,
        blockedOperationCount: operations.filter((operation) => operation.status === "BLOCKED").length,
      },
      machines: machines.map((machine) => {
        const load = byMachine.get(machine.id);
        return {
          ...machine,
          operationCount: load?.operationCount ?? 0,
          workOrderCount: load?.workOrderIds.size ?? 0,
          blockedOperationCount: load?.blockedCount ?? 0,
          earliestDueDate: load?.earliestDueDate ?? null,
        };
      }),
      unassignedOperations: unassignedOperations.slice(0, 50),
      missingInputs: [
        "Her operasyon için setup ve çevrim/standart süre",
        "Makine vardiya, tatil ve bakım takvimi",
        "Alternatif makine/operasyon yetkinlik kuralları",
      ],
    };
  }

  async run(tenantId: string, _userId: string) {
    const [openWorkOrders, materials, partStocks] = await Promise.all([
      this.prisma.workOrder.findMany({
        where: { tenantId, status: "PLANNED" },
        select: { id: true, partId: true, quantity: true, dueDate: true },
      }),
      this.prisma.material.findMany({ where: { tenantId } }),
      this.prisma.partStock.findMany({ where: { tenantId } }),
    ]);

    const demandByPart = new Map<string, { qty: number; dueDate: Date }>();
    for (const wo of openWorkOrders) {
      const qty = Number(wo.quantity);
      const existing = demandByPart.get(wo.partId);
      if (existing) {
        existing.qty += qty;
        if (wo.dueDate < existing.dueDate) existing.dueDate = wo.dueDate;
      } else {
        demandByPart.set(wo.partId, { qty, dueDate: wo.dueDate });
      }
    }

    const partIds = [...demandByPart.keys()];
    const partStockByPart = new Map(partStocks.map((p) => [p.partId, Number(p.qty)]));

    // Faz K (çok seviyeli BOM): BOM grafiğini keşfet, her parçanın en derin
    // (low-level code / LLC) göründüğü seviyeyi bul — bir parça, kendisine
    // referans veren TÜM üst montajlar işlenmeden (ki bunlar her zaman daha
    // düşük LLC'dedir, DAG olduğu için) işlenmez. Böylece aynı alt montaj
    // birden fazla üst parçadan (diamond) talep ediliyorsa çifte sayım olmaz.
    // Döngüler BOM kayıt anında reddedildiği için (bkz. BomService) burada
    // sadece savunma amaçlı bir derinlik sınırı var.
    const MAX_BOM_DEPTH = 10;
    const bomByPart = new Map<string, Awaited<ReturnType<typeof this.prisma.bomHeader.findFirst>> & { lines: { itemType: string; itemId: string; qtyPer: unknown; scrapPct: unknown }[] } | null>();
    const llcByPart = new Map<string, number>();
    for (const id of partIds) llcByPart.set(id, 0);

    let frontier = new Set(partIds);
    for (let depth = 0; depth < MAX_BOM_DEPTH && frontier.size > 0; depth++) {
      const toFetch = [...frontier].filter((id) => !bomByPart.has(id));
      if (toFetch.length) {
        const boms = await this.prisma.bomHeader.findMany({
          where: { tenantId, partId: { in: toFetch }, isActive: true },
          include: { lines: true },
        });
        const found = new Set(boms.map((b) => b.partId));
        for (const b of boms) bomByPart.set(b.partId, b as never);
        for (const id of toFetch) if (!found.has(id)) bomByPart.set(id, null);
      }
      const next = new Set<string>();
      for (const partId of frontier) {
        const bom = bomByPart.get(partId);
        if (!bom) continue;
        for (const line of bom.lines) {
          if (line.itemType !== "PART") continue;
          const childDepth = depth + 1;
          if ((llcByPart.get(line.itemId) ?? -1) < childDepth) llcByPart.set(line.itemId, childDepth);
          next.add(line.itemId);
        }
      }
      frontier = next;
    }

    const unresolvedPartIds = partIds.filter((id) => !bomByPart.get(id));

    // Alt montaj (LLC>0) parçalarının zaten önerilmiş üretim miktarı — netleme için.
    const subPartIds = [...llcByPart.entries()].filter(([, llc]) => llc > 0).map(([id]) => id);
    const activeSubProposals = subPartIds.length
      ? await this.prisma.productionProposal.findMany({
          where: { tenantId, partId: { in: subPartIds }, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
          select: { partId: true, qty: true },
        })
      : [];
    const proposedBySub = new Map<string, number>();
    for (const p of activeSubProposals) {
      proposedBySub.set(p.partId, (proposedBySub.get(p.partId) ?? 0) + Number(p.qty));
    }

    const peggedQty = new Map<string, { qty: number; neededByDate: Date | null }>();
    for (const [partId, d] of demandByPart) peggedQty.set(partId, { qty: d.qty, neededByDate: d.dueDate });

    const grossByMaterial = new Map<string, { qty: number; neededByDate: Date | null }>();
    const subAssemblyShortfalls: { partId: string; qty: number; dueDate: Date }[] = [];
    const maxLlc = Math.max(0, ...llcByPart.values());

    for (let llc = 0; llc <= maxLlc; llc++) {
      const partsAtLevel = [...llcByPart.entries()].filter(([, l]) => l === llc).map(([id]) => id);
      for (const partId of partsAtLevel) {
        const pegged = peggedQty.get(partId);
        if (!pegged) continue;

        // Seviye 0 (doğrudan WorkOrder talebi): iş emri zaten planlanmış/taahhüt
        // edilmiş olduğundan malzeme ihtiyacı brüt miktar üzerinden hesaplanır
        // (üst parçanın kendi stoğuna bakılmaz — bu ayrı bir karar, aşağıdaki
        // mevcut productionShortfalls kontrolü). Seviye 1+ (alt montaj): sadece
        // kendi stoğu/zaten-önerilmiş üretimini karşılamayan NET eksik miktar
        // aşağı patlatılır ve yeni bir üretim önerisi olarak kaydedilir.
        let qtyToExplode = pegged.qty;
        if (llc > 0) {
          const onHand = partStockByPart.get(partId) ?? 0;
          const alreadyProposed = proposedBySub.get(partId) ?? 0;
          const shortfall = pegged.qty - onHand - alreadyProposed;
          if (shortfall <= 1e-9) continue;
          qtyToExplode = shortfall;
          subAssemblyShortfalls.push({ partId, qty: shortfall, dueDate: pegged.neededByDate ?? new Date() });
        }

        const bom = bomByPart.get(partId);
        if (!bom) continue;

        for (const line of bom.lines) {
          const scrapFactor = 1 + (line.scrapPct ? Number(line.scrapPct) / 100 : 0);
          const need = qtyToExplode * Number(line.qtyPer) * scrapFactor;
          if (line.itemType === "MATERIAL") {
            const existing = grossByMaterial.get(line.itemId);
            if (existing) {
              existing.qty += need;
              if (!existing.neededByDate || (pegged.neededByDate && pegged.neededByDate < existing.neededByDate)) {
                existing.neededByDate = pegged.neededByDate;
              }
            } else {
              grossByMaterial.set(line.itemId, { qty: need, neededByDate: pegged.neededByDate });
            }
          } else {
            const existing = peggedQty.get(line.itemId);
            if (existing) {
              existing.qty += need;
              if (pegged.neededByDate && (!existing.neededByDate || pegged.neededByDate < existing.neededByDate)) {
                existing.neededByDate = pegged.neededByDate;
              }
            } else {
              peggedQty.set(line.itemId, { qty: need, neededByDate: pegged.neededByDate });
            }
          }
        }
      }
    }

    for (const m of materials) {
      if (m.minStock == null) continue;
      const safety = Number(m.minStock);
      const existing = grossByMaterial.get(m.id);
      if (existing) {
        existing.qty += safety;
      } else {
        grossByMaterial.set(m.id, { qty: safety, neededByDate: null });
      }
    }

    const materialIds = [...grossByMaterial.keys()];
    const [openPoLines, activeProposalLines] = await Promise.all([
      materialIds.length
        ? this.prisma.purchaseOrderLine.findMany({
            where: {
              tenantId,
              materialId: { in: materialIds },
              purchaseOrder: { status: { in: ["ORDERED", "IN_TRANSIT"] } },
            },
            select: { materialId: true, quantity: true, receivedQty: true },
          })
        : Promise.resolve([]),
      materialIds.length
        ? this.prisma.purchaseProposalLine.findMany({
            where: {
              tenantId,
              materialId: { in: materialIds },
              purchaseProposal: { status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
            },
            select: { materialId: true, qty: true },
          })
        : Promise.resolve([]),
    ]);

    const openPoByMaterial = new Map<string, number>();
    for (const l of openPoLines) {
      const outstanding = Number(l.quantity) - Number(l.receivedQty);
      openPoByMaterial.set(l.materialId, (openPoByMaterial.get(l.materialId) ?? 0) + Math.max(0, outstanding));
    }
    const proposedByMaterial = new Map<string, number>();
    for (const l of activeProposalLines) {
      proposedByMaterial.set(l.materialId, (proposedByMaterial.get(l.materialId) ?? 0) + Number(l.qty));
    }

    const materialById = new Map(materials.map((m) => [m.id, m]));
    const shortfallLines: { materialId: string; qty: number; neededByDate: Date | null }[] = [];
    for (const [materialId, gross] of grossByMaterial) {
      const material = materialById.get(materialId);
      if (!material) continue;
      const onHand = Number(material.stockQty);
      const onOrder = openPoByMaterial.get(materialId) ?? 0;
      const alreadyProposed = proposedByMaterial.get(materialId) ?? 0;
      const shortfall = gross.qty - onHand - onOrder - alreadyProposed;
      if (shortfall > 1e-9) {
        shortfallLines.push({ materialId, qty: shortfall, neededByDate: gross.neededByDate });
      }
    }

    const activeProdProposals = partIds.length
      ? await this.prisma.productionProposal.findMany({
          where: { tenantId, partId: { in: partIds }, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
          select: { partId: true, qty: true },
        })
      : [];
    const proposedProdByPart = new Map<string, number>();
    for (const p of activeProdProposals) {
      proposedProdByPart.set(p.partId, (proposedProdByPart.get(p.partId) ?? 0) + Number(p.qty));
    }

    const productionShortfalls: { partId: string; qty: number; dueDate: Date }[] = [];
    for (const [partId, demand] of demandByPart) {
      const onHand = partStockByPart.get(partId) ?? 0;
      const alreadyProposed = proposedProdByPart.get(partId) ?? 0;
      const shortfall = demand.qty - onHand - alreadyProposed;
      if (shortfall > 1e-9) {
        productionShortfalls.push({ partId, qty: shortfall, dueDate: demand.dueDate });
      }
    }
    // Faz K: alt montaj (LLC>0) shortfall'ları da aynı üretim önerisi mekanizmasını
    // kullanır — onaylanınca aynı şekilde bir WorkOrder'a dönüşür (bkz.
    // decideProductionProposal), üst/alt parça arasında model düzeyinde fark yok.
    const allProductionShortfalls = [...productionShortfalls, ...subAssemblyShortfalls];

    if (shortfallLines.length === 0 && allProductionShortfalls.length === 0) {
      return { purchaseProposal: null, productionProposals: [], unresolvedPartIds };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let purchaseProposal = null as Awaited<ReturnType<typeof tx.purchaseProposal.create>> | null;
      if (shortfallLines.length > 0) {
        const ppNo = await nextDocNo(tx, "purchaseProposal", "ppNo", "PPR");
        purchaseProposal = await tx.purchaseProposal.create({
          data: {
            tenantId,
            ppNo,
            supplierId: null,
            lines: {
              create: shortfallLines.map((l) => ({
                tenantId,
                materialId: l.materialId,
                qty: l.qty,
                neededByDate: l.neededByDate,
              })),
            },
          },
        });
      }

      const productionProposals = [];
      for (const s of allProductionShortfalls) {
        const prNo = await nextDocNo(tx, "productionProposal", "prNo", "PRP");
        productionProposals.push(
          await tx.productionProposal.create({
            data: { tenantId, prNo, partId: s.partId, qty: s.qty, dueDate: s.dueDate },
          }),
        );
      }

      await this.outbox.record(tx, tenantId, "mrp", purchaseProposal?.id ?? tenantId, "mrp.proposal.created", {
        purchaseProposalId: purchaseProposal?.id,
        productionProposalCount: productionProposals.length,
      });

      return { purchaseProposal, productionProposals };
    });

    await this.notifications.notifyRoles(tenantId, ["PLANNER"], {
      type: "MRP_PROPOSAL_CREATED",
      title: "Yeni MRP önerisi oluşturuldu",
      message: `MRP çalıştırması ${result.purchaseProposal ? 1 : 0} satınalma önerisi ve ${result.productionProposals.length} üretim önerisi üretti`,
      entity: "mrp-run",
    });

    return { ...result, unresolvedPartIds };
  }

  listPurchaseProposals(tenantId: string, status?: string) {
    return this.prisma.purchaseProposal.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      include: PP_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  listProductionProposals(tenantId: string, status?: string) {
    return this.prisma.productionProposal.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      include: PRP_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findPurchaseProposal(tenantId: string, id: string) {
    const p = await this.prisma.purchaseProposal.findFirst({ where: { id, tenantId }, include: PP_INCLUDE });
    if (!p) throw new NotFoundException("Satınalma önerisi bulunamadı");
    return p;
  }

  async findProductionProposal(tenantId: string, id: string) {
    const p = await this.prisma.productionProposal.findFirst({ where: { id, tenantId }, include: PRP_INCLUDE });
    if (!p) throw new NotFoundException("Üretim önerisi bulunamadı");
    return p;
  }

  async submitPurchaseProposal(tenantId: string, userId: string, id: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.purchaseProposal.findFirst({ where: { id, tenantId } });
      if (!proposal) throw new NotFoundException("Satınalma önerisi bulunamadı");
      if (proposal.status !== "DRAFT") throw new ConflictException("Sadece taslak öneriler onaya gönderilebilir");
      await this.approvals.request(tenantId, userId, {
        entity: "purchase-proposal", entityId: id, requiredRoles: ["PLANNER"],
      }, tx);
      const result = await tx.purchaseProposal.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      await this.outbox.record(tx, tenantId, "purchaseproposal", id, "purchaseproposal.updated", { id, status: result.status });
      return result;
    });
    return updated;
  }

  async submitProductionProposal(tenantId: string, userId: string, id: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.productionProposal.findFirst({ where: { id, tenantId } });
      if (!proposal) throw new NotFoundException("Üretim önerisi bulunamadı");
      if (proposal.status !== "DRAFT") throw new ConflictException("Sadece taslak öneriler onaya gönderilebilir");
      await this.approvals.request(tenantId, userId, {
        entity: "production-proposal", entityId: id, requiredRoles: ["PLANNER"],
      }, tx);
      const result = await tx.productionProposal.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      await this.outbox.record(tx, tenantId, "productionproposal", id, "productionproposal.updated", { id, status: result.status });
      return result;
    });
    return updated;
  }

  private async findPendingApproval(tenantId: string, entity: string, entityId: string) {
    const req = await this.prisma.approvalRequest.findFirst({
      where: { tenantId, entity, entityId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (!req) throw new NotFoundException("Bekleyen onay talebi bulunamadı — önce öneri onaya gönderilmeli");
    return req;
  }

  async decidePurchaseProposal(
    tenantId: string,
    id: string,
    decidedById: string,
    decidedRole: Role,
    action: Decision,
    note: string | undefined,
    supplierId: string | undefined,
    password: string,
  ) {
    // AHK-006: satın alma önerisi kararı (siparişe dönüşür) kritik — bağımsız reauth.
    const reauth = await this.auth.reauthenticate(tenantId, decidedById, password);
    const result = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.purchaseProposal.findFirst({ where: { id, tenantId }, include: { lines: true } });
      if (!proposal) throw new NotFoundException("Satınalma önerisi bulunamadı");
      if (proposal.status !== "PENDING_APPROVAL") throw new ConflictException("Sadece onay bekleyen öneriler karara bağlanabilir");
      const approvalReq = await tx.approvalRequest.findFirst({ where: { tenantId, entity: "purchase-proposal", entityId: id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
      if (!approvalReq) throw new NotFoundException("Bekleyen onay talebi bulunamadı");
      if (action === "reject") {
        await this.approvals.reject(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth);
        const updated = await tx.purchaseProposal.update({ where: { id }, data: { status: "REJECTED" } });
        await this.outbox.record(tx, tenantId, "purchaseproposal", id, "purchaseproposal.updated", { id, status: updated.status });
        return { updated, approvalReq, status: "REJECTED" as const };
      }
      const chosenSupplierId = supplierId ?? proposal.supplierId;
      if (!chosenSupplierId) throw new ConflictException("Satınalma önerisini onaylamak için tedarikçi seçilmeli");
      const po = await this.purchasing.createInTransaction(tx, tenantId, decidedById, {
        supplierId: chosenSupplierId, currency: "TRY", orderDate: new Date(), notes: `MRP önerisinden (${proposal.ppNo}) otomatik oluşturuldu`,
        lines: proposal.lines.map((l) => ({ materialId: l.materialId, quantity: Number(l.qty), unitPrice: 0 })),
      });
      await this.approvals.approve(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth);
      const updated = await tx.purchaseProposal.update({ where: { id }, data: { status: "CONVERTED", convertedToId: po.id, supplierId: chosenSupplierId } });
      await this.outbox.record(tx, tenantId, "purchaseproposal", id, "purchaseproposal.updated", { id, status: updated.status });
      return { updated, approvalReq, status: "APPROVED" as const };
    });
    await this.approvals.notifyDecision(tenantId, result.approvalReq, result.status, note);
    return result.updated;
  }

  async decideProductionProposal(
    tenantId: string,
    id: string,
    decidedById: string,
    decidedRole: Role,
    action: Decision,
    note: string | undefined,
    password: string,
  ) {
    // AHK-006: üretim önerisi kararı (iş emrine dönüşür) kritik — bağımsız reauth.
    const reauth = await this.auth.reauthenticate(tenantId, decidedById, password);
    const result = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.productionProposal.findFirst({ where: { id, tenantId } });
      if (!proposal) throw new NotFoundException("Üretim önerisi bulunamadı");
      if (proposal.status !== "PENDING_APPROVAL") throw new ConflictException("Sadece onay bekleyen öneriler karara bağlanabilir");
      const approvalReq = await tx.approvalRequest.findFirst({ where: { tenantId, entity: "production-proposal", entityId: id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
      if (!approvalReq) throw new NotFoundException("Bekleyen onay talebi bulunamadı");
      if (action === "reject") {
        await this.approvals.reject(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth);
        const updated = await tx.productionProposal.update({ where: { id }, data: { status: "REJECTED" } });
        await this.outbox.record(tx, tenantId, "productionproposal", id, "productionproposal.updated", { id, status: updated.status });
        return { updated, approvalReq, status: "REJECTED" as const };
      }
      const wo = await this.workOrders.createInTransaction(tx, tenantId, { partId: proposal.partId, quantity: Number(proposal.qty), dueDate: proposal.dueDate, priority: 5 });
      await this.approvals.approve(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth);
      const updated = await tx.productionProposal.update({ where: { id }, data: { status: "CONVERTED", convertedToId: wo.id } });
      await this.outbox.record(tx, tenantId, "productionproposal", id, "productionproposal.updated", { id, status: updated.status });
      return { updated, approvalReq, status: "APPROVED" as const };
    });
    await this.approvals.notifyDecision(tenantId, result.approvalReq, result.status, note);
    return result.updated;
  }
}
