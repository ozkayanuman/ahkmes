import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type GlPostingKey, type GlSourceType } from "@prisma/client";
import type {
  CreateGlAccountDto,
  CreateJournalEntryDto,
  FiscalPeriodRefDto,
  ReverseJournalEntryDto,
  SetGlPostingAccountDto,
  UpdateGlAccountDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { nextDocNo } from "../common/numbering";

type Tx = Prisma.TransactionClient;

const ENTRY_INCLUDE = {
  lines: { orderBy: { lineNo: "asc" }, include: { account: { select: { id: true, code: true, name: true, type: true } } } },
  createdBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
  reversalOf: { select: { id: true, jeNo: true } },
  reversal: { select: { id: true, jeNo: true } },
} satisfies Prisma.JournalEntryInclude;

/** Tek Düzen Hesap Planı'ndan V1 için yeterli bir çekirdek alt küme. */
export const DEFAULT_CHART: { code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"; postingAllowed?: boolean }[] = [
  { code: "100", name: "Kasa", type: "ASSET" },
  { code: "102", name: "Bankalar", type: "ASSET" },
  { code: "120", name: "Alıcılar", type: "ASSET" },
  { code: "150", name: "İlk Madde ve Malzeme", type: "ASSET" },
  { code: "151", name: "Yarı Mamuller", type: "ASSET" },
  { code: "152", name: "Mamuller", type: "ASSET" },
  { code: "153", name: "Ticari Mallar", type: "ASSET" },
  { code: "191", name: "İndirilecek KDV", type: "ASSET" },
  { code: "253", name: "Tesis, Makine ve Cihazlar", type: "ASSET" },
  { code: "257", name: "Birikmiş Amortismanlar (-)", type: "ASSET" },
  { code: "320", name: "Satıcılar", type: "LIABILITY" },
  { code: "360", name: "Ödenecek Vergi ve Fonlar", type: "LIABILITY" },
  { code: "391", name: "Hesaplanan KDV", type: "LIABILITY" },
  { code: "500", name: "Sermaye", type: "EQUITY" },
  { code: "570", name: "Geçmiş Yıllar Kârları", type: "EQUITY" },
  { code: "590", name: "Dönem Net Kârı", type: "EQUITY" },
  { code: "600", name: "Yurtiçi Satışlar", type: "REVENUE" },
  { code: "601", name: "Yurtdışı Satışlar", type: "REVENUE" },
  { code: "610", name: "Satıştan İadeler (-)", type: "REVENUE" },
  { code: "620", name: "Satılan Mamuller Maliyeti (-)", type: "EXPENSE" },
  { code: "621", name: "Satılan Ticari Mallar Maliyeti (-)", type: "EXPENSE" },
  { code: "710", name: "Direkt İlk Madde ve Malzeme Giderleri", type: "EXPENSE" },
  { code: "720", name: "Direkt İşçilik Giderleri", type: "EXPENSE" },
  { code: "730", name: "Genel Üretim Giderleri", type: "EXPENSE" },
  { code: "770", name: "Genel Yönetim Giderleri", type: "EXPENSE" },
];

const DEFAULT_POSTING_MAP: Record<GlPostingKey, string> = {
  AR_RECEIVABLE: "120",
  SALES_REVENUE: "600",
  AP_PAYABLE: "320",
  PURCHASE_EXPENSE: "150",
  BANK: "102",
};

export type SubledgerSkipReason = "MAPPING_MISSING" | "PERIOD_CLOSED" | "ZERO_AMOUNT";

export interface SubledgerSyncResult {
  posted: { sourceType: GlSourceType; sourceId: string; docNo: string; jeNo: string }[];
  reversed: { sourceType: GlSourceType; sourceId: string; docNo: string; jeNo: string }[];
  skipped: { sourceType: GlSourceType; sourceId: string; docNo: string; reason: SubledgerSkipReason }[];
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
}

type SubledgerDoc = {
  sourceType: Exclude<GlSourceType, "MANUAL">;
  sourceId: string;
  docNo: string;
  cancelled: boolean;
  date: Date;
  amount: number;
  debitKey: GlPostingKey;
  creditKey: GlPostingKey;
  description: string;
};

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function sumLines(lines: { qty: Prisma.Decimal | number; unitPrice: Prisma.Decimal | number }[]) {
  return money(lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0));
}

/**
 * Faz G+ General Ledger. Double-entry bookkeeping with an explicit posting
 * step, immutable posted entries (corrections happen through reversal
 * entries), monthly fiscal periods and idempotent posting from the AR/AP
 * subledgers. Everything the ledger cannot post is reported with a reason
 * rather than silently skipped.
 */
@Injectable()
export class GlService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- Chart of accounts ----------------

  listAccounts(tenantId: string) {
    return this.prisma.glAccount.findMany({
      where: { tenantId },
      orderBy: { code: "asc" },
      include: { parent: { select: { id: true, code: true, name: true } }, _count: { select: { lines: true } } },
    });
  }

  async createAccount(tenantId: string, dto: CreateGlAccountDto) {
    if (dto.parentId) await this.assertAccount(tenantId, dto.parentId);
    try {
      return await this.prisma.glAccount.create({
        data: { tenantId, code: dto.code, name: dto.name, type: dto.type, parentId: dto.parentId ?? null, postingAllowed: dto.postingAllowed },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ConflictException(`Hesap kodu zaten var: ${dto.code}`);
      throw err;
    }
  }

  async updateAccount(tenantId: string, id: string, dto: UpdateGlAccountDto) {
    await this.assertAccount(tenantId, id);
    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException("Hesap kendi üst hesabı olamaz");
      await this.assertAccount(tenantId, dto.parentId);
    }
    return this.prisma.glAccount.update({ where: { id }, data: dto });
  }

  /** Idempotent: existing codes are left untouched; the posting map is only filled where missing. */
  async seedDefaultChart(tenantId: string) {
    const existing = await this.prisma.glAccount.findMany({ where: { tenantId }, select: { code: true } });
    const have = new Set(existing.map((a) => a.code));
    const toCreate = DEFAULT_CHART.filter((a) => !have.has(a.code));
    if (toCreate.length > 0) {
      await this.prisma.glAccount.createMany({
        data: toCreate.map((a) => ({ tenantId, code: a.code, name: a.name, type: a.type, postingAllowed: a.postingAllowed ?? true })),
      });
    }
    const accounts = await this.prisma.glAccount.findMany({ where: { tenantId }, select: { id: true, code: true } });
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    const mapped = await this.prisma.glPostingAccount.findMany({ where: { tenantId }, select: { key: true } });
    const mappedKeys = new Set(mapped.map((m) => m.key));
    let mappedCount = 0;
    for (const [key, code] of Object.entries(DEFAULT_POSTING_MAP) as [GlPostingKey, string][]) {
      const accountId = byCode.get(code);
      if (mappedKeys.has(key) || !accountId) continue;
      await this.prisma.glPostingAccount.create({ data: { tenantId, key, accountId } });
      mappedCount += 1;
    }
    return { createdAccounts: toCreate.length, mappedKeys: mappedCount };
  }

  listPostingAccounts(tenantId: string) {
    return this.prisma.glPostingAccount.findMany({ where: { tenantId }, include: { account: { select: { id: true, code: true, name: true } } }, orderBy: { key: "asc" } });
  }

  async setPostingAccount(tenantId: string, dto: SetGlPostingAccountDto) {
    const account = await this.assertAccount(tenantId, dto.accountId);
    if (!account.postingAllowed || !account.isActive) throw new BadRequestException("Eşlenen hesap aktif ve kayıt yapılabilir olmalı");
    return this.prisma.glPostingAccount.upsert({
      where: { tenantId_key: { tenantId, key: dto.key } },
      create: { tenantId, key: dto.key, accountId: dto.accountId },
      update: { accountId: dto.accountId },
      include: { account: { select: { id: true, code: true, name: true } } },
    });
  }

  private async assertAccount(tenantId: string, id: string) {
    const account = await this.prisma.glAccount.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException("Hesap bulunamadı");
    return account;
  }

  // ---------------- Fiscal periods ----------------

  listPeriods(tenantId: string) {
    return this.prisma.fiscalPeriod.findMany({ where: { tenantId }, orderBy: [{ year: "desc" }, { month: "desc" }], include: { closedBy: { select: { id: true, name: true } } } });
  }

  /** Periods are created lazily as OPEN on first use; a CLOSED period rejects postings. */
  private async assertPeriodOpen(tx: Tx, tenantId: string, date: Date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const period = await tx.fiscalPeriod.upsert({
      where: { tenantId_year_month: { tenantId, year, month } },
      create: { tenantId, year, month },
      update: {},
    });
    if (period.status === "CLOSED") throw new ConflictException(`Mali dönem kapalı: ${year}-${String(month).padStart(2, "0")}`);
    return period;
  }

  async closePeriod(tenantId: string, userId: string, dto: FiscalPeriodRefDto) {
    const drafts = await this.prisma.journalEntry.count({
      where: { tenantId, status: "DRAFT", entryDate: { gte: new Date(Date.UTC(dto.year, dto.month - 1, 1)), lt: new Date(Date.UTC(dto.year, dto.month, 1)) } },
    });
    if (drafts > 0) throw new ConflictException(`Dönemde ${drafts} taslak yevmiye var; kapatmadan önce kaydedin veya silin`);
    return this.prisma.fiscalPeriod.upsert({
      where: { tenantId_year_month: { tenantId, year: dto.year, month: dto.month } },
      create: { tenantId, year: dto.year, month: dto.month, status: "CLOSED", closedAt: new Date(), closedById: userId },
      update: { status: "CLOSED", closedAt: new Date(), closedById: userId },
    });
  }

  async reopenPeriod(tenantId: string, dto: FiscalPeriodRefDto) {
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { tenantId, year: dto.year, month: dto.month } });
    if (!period) throw new NotFoundException("Mali dönem bulunamadı");
    return this.prisma.fiscalPeriod.update({ where: { id: period.id }, data: { status: "OPEN", closedAt: null, closedById: null } });
  }

  // ---------------- Journal entries ----------------

  listEntries(tenantId: string, filter: { status?: string; from?: Date; to?: Date; sourceType?: string } = {}) {
    return this.prisma.journalEntry.findMany({
      where: {
        tenantId,
        ...(filter.status ? { status: filter.status as never } : {}),
        ...(filter.sourceType ? { sourceType: filter.sourceType as never } : {}),
        ...(filter.from || filter.to ? { entryDate: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
      },
      include: ENTRY_INCLUDE,
      orderBy: [{ entryDate: "desc" }, { jeNo: "desc" }],
      take: 500,
    });
  }

  async getEntry(tenantId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({ where: { id, tenantId }, include: ENTRY_INCLUDE });
    if (!entry) throw new NotFoundException("Yevmiye kaydı bulunamadı");
    return entry;
  }

  async createEntry(tenantId: string, userId: string, dto: CreateJournalEntryDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.validateLines(tx, tenantId, dto.lines);
      const jeNo = await nextDocNo(tx, "journalEntry", "jeNo", "YEV");
      return tx.journalEntry.create({
        data: {
          tenantId,
          jeNo,
          entryDate: dto.entryDate,
          description: dto.description,
          status: "DRAFT",
          sourceType: "MANUAL",
          createdById: userId,
          lines: { create: dto.lines.map((l, i) => ({ tenantId, accountId: l.accountId, lineNo: i + 1, debit: money(l.debit), credit: money(l.credit), description: l.description ?? null })) },
        },
        include: ENTRY_INCLUDE,
      });
    });
  }

  async postEntry(tenantId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({ where: { id, tenantId }, include: { lines: true } });
      if (!entry) throw new NotFoundException("Yevmiye kaydı bulunamadı");
      if (entry.status !== "DRAFT") throw new ConflictException("Yalnızca taslak kayıtlar kaydedilebilir");
      await this.validateLines(tx, tenantId, entry.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) })));
      await this.assertPeriodOpen(tx, tenantId, entry.entryDate);
      return tx.journalEntry.update({ where: { id }, data: { status: "POSTED", postedAt: new Date(), postedById: userId }, include: ENTRY_INCLUDE });
    });
  }

  async deleteDraft(tenantId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({ where: { id, tenantId } });
    if (!entry) throw new NotFoundException("Yevmiye kaydı bulunamadı");
    if (entry.status !== "DRAFT") throw new ConflictException("Yalnızca taslak kayıtlar silinebilir; kayıtlı bir yevmiye ters kayıtla düzeltilir");
    await this.prisma.journalEntry.delete({ where: { id } });
    return { id };
  }

  /** A posted entry is never edited: the correction is a mirrored, posted entry linked back to the original. */
  async reverseEntry(tenantId: string, userId: string, id: string, dto: ReverseJournalEntryDto = {}) {
    return this.prisma.$transaction(async (tx) => this.reverseInTx(tx, tenantId, userId, id, dto));
  }

  private async reverseInTx(tx: Tx, tenantId: string, userId: string, id: string, dto: ReverseJournalEntryDto) {
    const entry = await tx.journalEntry.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    if (!entry) throw new NotFoundException("Yevmiye kaydı bulunamadı");
    if (entry.status !== "POSTED") throw new ConflictException("Yalnızca kayıtlı (POSTED) yevmiyeler ters kayıtla kapatılabilir");
    const entryDate = dto.entryDate ?? new Date();
    await this.assertPeriodOpen(tx, tenantId, entryDate);
    const jeNo = await nextDocNo(tx, "journalEntry", "jeNo", "YEV");
    const reversal = await tx.journalEntry.create({
      data: {
        tenantId,
        jeNo,
        entryDate,
        description: dto.description ?? `Ters kayıt: ${entry.jeNo} — ${entry.description}`,
        status: "POSTED",
        sourceType: entry.sourceType,
        sourceId: null,
        reversalOfId: entry.id,
        postedAt: new Date(),
        postedById: userId,
        createdById: userId,
        lines: { create: entry.lines.map((l) => ({ tenantId, accountId: l.accountId, lineNo: l.lineNo, debit: l.credit, credit: l.debit, description: l.description })) },
      },
      include: ENTRY_INCLUDE,
    });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { status: "REVERSED" } });
    return reversal;
  }

  private async validateLines(tx: Tx, tenantId: string, lines: { accountId: string; debit: number; credit: number }[]) {
    if (lines.length < 2) throw new BadRequestException("Yevmiye en az iki satır içermeli");
    const debit = money(lines.reduce((s, l) => s + l.debit, 0));
    const credit = money(lines.reduce((s, l) => s + l.credit, 0));
    if (debit !== credit) throw new BadRequestException(`Borç (${debit}) ve alacak (${credit}) toplamları eşit değil`);
    if (debit <= 0) throw new BadRequestException("Yevmiye tutarı sıfırdan büyük olmalı");
    const ids = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await tx.glAccount.findMany({ where: { tenantId, id: { in: ids } } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    for (const id of ids) {
      const account = byId.get(id);
      if (!account) throw new NotFoundException("Hesap bulunamadı");
      if (!account.isActive) throw new BadRequestException(`Pasif hesaba kayıt yapılamaz: ${account.code}`);
      if (!account.postingAllowed) throw new BadRequestException(`Ana hesaba kayıt yapılamaz: ${account.code} (yaprak hesap seçin)`);
    }
  }

  // ---------------- Reports ----------------

  async trialBalance(tenantId: string, from: Date, to: Date): Promise<{ rows: TrialBalanceRow[]; totals: { openingBalance: number; periodDebit: number; periodCredit: number; closingBalance: number } }> {
    const accounts = await this.prisma.glAccount.findMany({ where: { tenantId }, orderBy: { code: "asc" } });
    const postedStatus: Prisma.EnumJournalEntryStatusFilter = { in: ["POSTED", "REVERSED"] };
    const [opening, period] = await Promise.all([
      this.prisma.journalLine.groupBy({
        by: ["accountId"],
        where: { tenantId, journalEntry: { status: postedStatus, entryDate: { lt: from } } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalLine.groupBy({
        by: ["accountId"],
        where: { tenantId, journalEntry: { status: postedStatus, entryDate: { gte: from, lte: to } } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const openingBy = new Map(opening.map((o) => [o.accountId, money(Number(o._sum.debit ?? 0) - Number(o._sum.credit ?? 0))]));
    const periodBy = new Map(period.map((p) => [p.accountId, { debit: money(Number(p._sum.debit ?? 0)), credit: money(Number(p._sum.credit ?? 0)) }]));
    const rows: TrialBalanceRow[] = [];
    for (const a of accounts) {
      const ob = openingBy.get(a.id) ?? 0;
      const p = periodBy.get(a.id) ?? { debit: 0, credit: 0 };
      if (ob === 0 && p.debit === 0 && p.credit === 0) continue;
      rows.push({ accountId: a.id, code: a.code, name: a.name, type: a.type, openingBalance: ob, periodDebit: p.debit, periodCredit: p.credit, closingBalance: money(ob + p.debit - p.credit) });
    }
    const totals = rows.reduce(
      (t, r) => ({ openingBalance: money(t.openingBalance + r.openingBalance), periodDebit: money(t.periodDebit + r.periodDebit), periodCredit: money(t.periodCredit + r.periodCredit), closingBalance: money(t.closingBalance + r.closingBalance) }),
      { openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0 },
    );
    return { rows, totals };
  }

  async accountLedger(tenantId: string, accountId: string, from: Date, to: Date) {
    const account = await this.assertAccount(tenantId, accountId);
    const opening = await this.prisma.journalLine.aggregate({
      where: { tenantId, accountId, journalEntry: { status: { in: ["POSTED", "REVERSED"] }, entryDate: { lt: from } } },
      _sum: { debit: true, credit: true },
    });
    const lines = await this.prisma.journalLine.findMany({
      where: { tenantId, accountId, journalEntry: { status: { in: ["POSTED", "REVERSED"] }, entryDate: { gte: from, lte: to } } },
      include: { journalEntry: { select: { id: true, jeNo: true, entryDate: true, description: true, sourceType: true, status: true } } },
      orderBy: [{ journalEntry: { entryDate: "asc" } }, { journalEntry: { jeNo: "asc" } }, { lineNo: "asc" }],
    });
    let balance = money(Number(opening._sum.debit ?? 0) - Number(opening._sum.credit ?? 0));
    const openingBalance = balance;
    const rows = lines.map((l) => {
      balance = money(balance + Number(l.debit) - Number(l.credit));
      return { id: l.id, entry: l.journalEntry, debit: Number(l.debit), credit: Number(l.credit), description: l.description, balance };
    });
    return { account: { id: account.id, code: account.code, name: account.name, type: account.type }, openingBalance, closingBalance: balance, rows };
  }

  // ---------------- Subledger posting ----------------

  /**
   * Pull-based, idempotent sync of AR/AP documents into the ledger. Safe to
   * call repeatedly: the (tenantId, sourceType, sourceId) unique key prevents a
   * second posting of the same document, and cancelled documents are reversed
   * exactly once.
   */
  async syncSubledgers(tenantId: string, userId: string): Promise<SubledgerSyncResult> {
    const result: SubledgerSyncResult = { posted: [], reversed: [], skipped: [] };
    const map = await this.postingMap(tenantId);
    const existing = await this.prisma.journalEntry.findMany({
      where: { tenantId, sourceType: { not: "MANUAL" }, sourceId: { not: null } },
      select: { id: true, jeNo: true, sourceType: true, sourceId: true, status: true },
    });
    const byKey = new Map(existing.map((e) => [`${e.sourceType}|${e.sourceId}`, e]));
    for (const doc of await this.loadSubledgerDocs(tenantId)) await this.syncDocument(tenantId, userId, result, byKey, doc, map);
    return result;
  }

  /** Posts (or reverses) a single subledger document; used by the AR/AP hooks right after their own commit. */
  async postSource(tenantId: string, userId: string, sourceType: Exclude<GlSourceType, "MANUAL">, sourceId: string): Promise<SubledgerSyncResult> {
    const result: SubledgerSyncResult = { posted: [], reversed: [], skipped: [] };
    const map = await this.postingMap(tenantId);
    const existing = await this.prisma.journalEntry.findFirst({ where: { tenantId, sourceType, sourceId }, select: { id: true, jeNo: true, sourceType: true, sourceId: true, status: true } });
    const byKey = new Map(existing ? [[`${sourceType}|${sourceId}`, existing]] : []);
    const docs = await this.loadSubledgerDocs(tenantId, { sourceType, sourceId });
    for (const doc of docs) await this.syncDocument(tenantId, userId, result, byKey, doc, map);
    return result;
  }

  private async loadSubledgerDocs(tenantId: string, only?: { sourceType: GlSourceType; sourceId: string }): Promise<SubledgerDoc[]> {
    const docs: SubledgerDoc[] = [];
    const want = (type: GlSourceType) => !only || only.sourceType === type;
    const idFilter = only ? { id: only.sourceId } : {};
    if (want("CUSTOMER_INVOICE")) {
      const rows = await this.prisma.invoice.findMany({ where: { tenantId, ...idFilter }, select: { id: true, invNo: true, status: true, issuedDate: true, lines: { select: { qty: true, unitPrice: true } } } });
      for (const inv of rows) docs.push({ sourceType: "CUSTOMER_INVOICE", sourceId: inv.id, docNo: inv.invNo, cancelled: inv.status === "CANCELLED", date: inv.issuedDate, amount: sumLines(inv.lines), debitKey: "AR_RECEIVABLE", creditKey: "SALES_REVENUE", description: `Müşteri faturası ${inv.invNo}` });
    }
    if (want("SUPPLIER_INVOICE")) {
      const rows = await this.prisma.supplierInvoice.findMany({ where: { tenantId, ...idFilter }, select: { id: true, sinNo: true, status: true, issuedDate: true, lines: { select: { qty: true, unitPrice: true } } } });
      for (const inv of rows) docs.push({ sourceType: "SUPPLIER_INVOICE", sourceId: inv.id, docNo: inv.sinNo, cancelled: inv.status === "CANCELLED", date: inv.issuedDate, amount: sumLines(inv.lines), debitKey: "PURCHASE_EXPENSE", creditKey: "AP_PAYABLE", description: `Tedarikçi faturası ${inv.sinNo}` });
    }
    if (want("CUSTOMER_PAYMENT")) {
      const rows = await this.prisma.customerPayment.findMany({ where: { tenantId, ...idFilter }, select: { id: true, cpNo: true, amount: true, paymentDate: true } });
      for (const p of rows) docs.push({ sourceType: "CUSTOMER_PAYMENT", sourceId: p.id, docNo: p.cpNo, cancelled: false, date: p.paymentDate, amount: money(Number(p.amount)), debitKey: "BANK", creditKey: "AR_RECEIVABLE", description: `Müşteri tahsilatı ${p.cpNo}` });
    }
    if (want("SUPPLIER_PAYMENT")) {
      const rows = await this.prisma.supplierPayment.findMany({ where: { tenantId, ...idFilter }, select: { id: true, spNo: true, amount: true, paymentDate: true } });
      for (const p of rows) docs.push({ sourceType: "SUPPLIER_PAYMENT", sourceId: p.id, docNo: p.spNo, cancelled: false, date: p.paymentDate, amount: money(Number(p.amount)), debitKey: "AP_PAYABLE", creditKey: "BANK", description: `Tedarikçi ödemesi ${p.spNo}` });
    }
    return docs;
  }

  private async postingMap(tenantId: string) {
    const rows = await this.prisma.glPostingAccount.findMany({ where: { tenantId }, select: { key: true, accountId: true } });
    return new Map(rows.map((r) => [r.key, r.accountId]));
  }

  private async syncDocument(
    tenantId: string,
    userId: string,
    result: SubledgerSyncResult,
    byKey: Map<string, { id: string; jeNo: string; status: string }>,
    doc: SubledgerDoc,
    map: Map<GlPostingKey, string>,
  ) {
    const key = `${doc.sourceType}|${doc.sourceId}`;
    const existing = byKey.get(key);
    const ref = { sourceType: doc.sourceType, sourceId: doc.sourceId, docNo: doc.docNo };

    if (existing) {
      // Already in the ledger. A cancelled document whose entry is still POSTED needs exactly one reversal.
      if (doc.cancelled && existing.status === "POSTED") {
        try {
          const reversal = await this.prisma.$transaction((tx) => this.reverseInTx(tx, tenantId, userId, existing.id, { description: `İptal: ${doc.description}` }));
          existing.status = "REVERSED";
          result.reversed.push({ ...ref, jeNo: reversal.jeNo });
        } catch (err) {
          if (err instanceof ConflictException) result.skipped.push({ ...ref, reason: "PERIOD_CLOSED" });
          else throw err;
        }
      }
      return;
    }
    if (doc.cancelled) return; // never posted, nothing to reverse
    if (doc.amount <= 0) {
      result.skipped.push({ ...ref, reason: "ZERO_AMOUNT" });
      return;
    }
    const debitAccountId = map.get(doc.debitKey);
    const creditAccountId = map.get(doc.creditKey);
    if (!debitAccountId || !creditAccountId) {
      result.skipped.push({ ...ref, reason: "MAPPING_MISSING" });
      return;
    }
    try {
      const entry = await this.prisma.$transaction(async (tx) => {
        await this.assertPeriodOpen(tx, tenantId, doc.date);
        const jeNo = await nextDocNo(tx, "journalEntry", "jeNo", "YEV");
        return tx.journalEntry.create({
          data: {
            tenantId,
            jeNo,
            entryDate: doc.date,
            description: doc.description,
            status: "POSTED",
            sourceType: doc.sourceType,
            sourceId: doc.sourceId,
            postedAt: new Date(),
            postedById: userId,
            createdById: userId,
            lines: {
              create: [
                { tenantId, accountId: debitAccountId, lineNo: 1, debit: doc.amount, credit: 0 },
                { tenantId, accountId: creditAccountId, lineNo: 2, debit: 0, credit: doc.amount },
              ],
            },
          },
          select: { id: true, jeNo: true, status: true },
        });
      });
      byKey.set(key, entry);
      result.posted.push({ ...ref, jeNo: entry.jeNo });
    } catch (err) {
      if (err instanceof ConflictException) {
        result.skipped.push({ ...ref, reason: "PERIOD_CLOSED" });
        return;
      }
      // Lost a race with a concurrent sync: the document is already in the ledger, which is the desired end state.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
      throw err;
    }
  }
}
