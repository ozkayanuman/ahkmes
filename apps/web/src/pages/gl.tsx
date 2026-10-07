import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtMoney } from "../lib/format";
import { Button, Card, Input, Label, Modal, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
type EntryStatus = "DRAFT" | "POSTED" | "REVERSED";
type Tab = "entries" | "trial-balance" | "accounts" | "periods";

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isActive: boolean;
  postingAllowed: boolean;
  parent: { id: string; code: string; name: string } | null;
  _count: { lines: number };
}
interface EntryLine {
  id: string;
  lineNo: number;
  debit: string;
  credit: string;
  description: string | null;
  account: { id: string; code: string; name: string };
}
interface EntryRow {
  id: string;
  jeNo: string;
  entryDate: string;
  description: string;
  status: EntryStatus;
  sourceType: string;
  lines: EntryLine[];
  createdBy: { name: string };
  postedBy: { name: string } | null;
  reversalOf: { id: string; jeNo: string } | null;
  reversal: { id: string; jeNo: string } | null;
}
interface TrialBalance {
  rows: { accountId: string; code: string; name: string; type: AccountType; openingBalance: number; periodDebit: number; periodCredit: number; closingBalance: number }[];
  totals: { openingBalance: number; periodDebit: number; periodCredit: number; closingBalance: number };
}
interface PeriodRow {
  id: string;
  year: number;
  month: number;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
  closedBy: { name: string } | null;
}
interface PostingAccountRow {
  key: string;
  account: { id: string; code: string; name: string };
}
interface SyncResult {
  posted: { docNo: string; jeNo: string }[];
  reversed: { docNo: string; jeNo: string }[];
  skipped: { docNo: string; reason: string }[];
}

const TYPE_LABELS: Record<AccountType, string> = { ASSET: "Varlık", LIABILITY: "Borç", EQUITY: "Özkaynak", REVENUE: "Gelir", EXPENSE: "Gider" };
const STATUS_LABELS: Record<EntryStatus, string> = { DRAFT: "Taslak", POSTED: "Kayıtlı", REVERSED: "Ters kayıtla kapatıldı" };
const STATUS_CLASS: Record<EntryStatus, string> = { DRAFT: "bg-slate-100 text-slate-700", POSTED: "bg-emerald-100 text-emerald-700", REVERSED: "bg-amber-100 text-amber-700" };
const SOURCE_LABELS: Record<string, string> = { MANUAL: "Manuel", CUSTOMER_INVOICE: "Müşteri faturası", SUPPLIER_INVOICE: "Tedarikçi faturası", CUSTOMER_PAYMENT: "Müşteri tahsilatı", SUPPLIER_PAYMENT: "Tedarikçi ödemesi" };
const KEY_LABELS: Record<string, string> = { AR_RECEIVABLE: "Alıcılar (AR)", SALES_REVENUE: "Satış geliri", AP_PAYABLE: "Satıcılar (AP)", PURCHASE_EXPENSE: "Alış / stok", BANK: "Banka" };
const SKIP_LABELS: Record<string, string> = { MAPPING_MISSING: "hesap eşlemesi eksik", PERIOD_CLOSED: "mali dönem kapalı", ZERO_AMOUNT: "tutar sıfır" };

const entryTotal = (e: EntryRow) => e.lines.reduce((s, l) => s + Number(l.debit), 0);
const monthStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);

type DraftLine = { accountId: string; debit: string; credit: string; description: string };
const emptyLine = (): DraftLine => ({ accountId: "", debit: "", credit: "", description: "" });

export function GlPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const isAdmin = user?.role === "ADMIN";
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("entries");

  const accounts = useQuery({ queryKey: ["/gl/accounts"], queryFn: () => apiGet<AccountRow[]>("/gl/accounts") });
  const postingAccounts = useQuery({ queryKey: ["/gl/posting-accounts"], queryFn: () => apiGet<PostingAccountRow[]>("/gl/posting-accounts") });
  const leafAccounts = useMemo(() => (accounts.data ?? []).filter((a) => a.isActive && a.postingAllowed), [accounts.data]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["/gl/entries"] });
    qc.invalidateQueries({ queryKey: ["/gl/trial-balance"] });
    qc.invalidateQueries({ queryKey: ["/gl/periods"] });
    qc.invalidateQueries({ queryKey: ["/gl/accounts"] });
    qc.invalidateQueries({ queryKey: ["/gl/posting-accounts"] });
  };
  const fail = (fallback: string) => (err: unknown) => toast(err instanceof ApiError ? err.message : fallback, "error");

  // ---- journal ----
  const [entryStatus, setEntryStatus] = useState("");
  const entries = useQuery({ queryKey: ["/gl/entries", entryStatus], queryFn: () => apiGet<EntryRow[]>(`/gl/entries${entryStatus ? `?status=${entryStatus}` : ""}`) });
  const [selected, setSelected] = useState<EntryRow | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const draftDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const draftCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(draftDebit - draftCredit) < 0.005 && draftDebit > 0;

  const createEntry = useMutation({
    mutationFn: () =>
      apiPost<EntryRow>("/gl/entries", {
        entryDate: new Date(`${entryDate}T00:00:00.000Z`).toISOString(),
        description,
        lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, ...(l.description ? { description: l.description } : {}) })),
      }),
    onSuccess: () => { invalidateAll(); setNewOpen(false); setDescription(""); setLines([emptyLine(), emptyLine()]); toast("Taslak yevmiye oluşturuldu.", "success"); },
    onError: fail("Yevmiye oluşturulamadı."),
  });
  const postEntry = useMutation({
    mutationFn: (id: string) => apiPost<EntryRow>(`/gl/entries/${id}/post`, {}),
    onSuccess: (data) => { invalidateAll(); setSelected(data); toast(`${data.jeNo} kaydedildi.`, "success"); },
    onError: fail("Kayıt yapılamadı."),
  });
  const reverseEntry = useMutation({
    mutationFn: (id: string) => apiPost<EntryRow>(`/gl/entries/${id}/reverse`, {}),
    onSuccess: (data) => { invalidateAll(); setSelected(null); toast(`Ters kayıt oluşturuldu: ${data.jeNo}`, "success"); },
    onError: fail("Ters kayıt yapılamadı."),
  });
  const deleteDraft = useMutation({
    mutationFn: (id: string) => apiDelete(`/gl/entries/${id}`),
    onSuccess: () => { invalidateAll(); setSelected(null); toast("Taslak silindi.", "success"); },
    onError: fail("Taslak silinemedi."),
  });
  const sync = useMutation({
    mutationFn: () => apiPost<SyncResult>("/gl/sync", {}),
    onSuccess: (r) => {
      invalidateAll();
      const parts = [`${r.posted.length} kayıt`, `${r.reversed.length} ters kayıt`];
      if (r.skipped.length > 0) parts.push(`${r.skipped.length} atlandı (${[...new Set(r.skipped.map((s) => SKIP_LABELS[s.reason] ?? s.reason))].join(", ")})`);
      toast(`Alt defter senkronu: ${parts.join(", ")}.`, r.skipped.length > 0 ? "error" : "success");
    },
    onError: fail("Senkron başarısız."),
  });

  // ---- trial balance ----
  const [tbFrom, setTbFrom] = useState(monthStart());
  const [tbTo, setTbTo] = useState(todayIso());
  const trialBalance = useQuery({
    queryKey: ["/gl/trial-balance", tbFrom, tbTo],
    queryFn: () => apiGet<TrialBalance>(`/gl/trial-balance?from=${tbFrom}T00:00:00.000Z&to=${tbTo}T23:59:59.999Z`),
    enabled: tab === "trial-balance",
  });

  // ---- accounts ----
  const [accOpen, setAccOpen] = useState(false);
  const [accForm, setAccForm] = useState({ code: "", name: "", type: "ASSET" as AccountType, parentId: "", postingAllowed: true });
  const seedDefault = useMutation({
    mutationFn: () => apiPost<{ createdAccounts: number; mappedKeys: number }>("/gl/accounts/seed-default", {}),
    onSuccess: (r) => { invalidateAll(); toast(`Hesap planı: ${r.createdAccounts} hesap, ${r.mappedKeys} eşleme eklendi.`, "success"); },
    onError: fail("Hesap planı yüklenemedi."),
  });
  const createAccount = useMutation({
    mutationFn: () => apiPost("/gl/accounts", { code: accForm.code, name: accForm.name, type: accForm.type, parentId: accForm.parentId || null, postingAllowed: accForm.postingAllowed }),
    onSuccess: () => { invalidateAll(); setAccOpen(false); setAccForm({ code: "", name: "", type: "ASSET", parentId: "", postingAllowed: true }); toast("Hesap eklendi.", "success"); },
    onError: fail("Hesap eklenemedi."),
  });
  const setPosting = useMutation({
    mutationFn: (body: { key: string; accountId: string }) => apiPost("/gl/posting-accounts", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/gl/posting-accounts"] }); toast("Eşleme güncellendi.", "success"); },
    onError: fail("Eşleme güncellenemedi."),
  });

  // ---- periods ----
  const periods = useQuery({ queryKey: ["/gl/periods"], queryFn: () => apiGet<PeriodRow[]>("/gl/periods"), enabled: tab === "periods" });
  const [periodForm, setPeriodForm] = useState({ year: String(new Date().getUTCFullYear()), month: String(new Date().getUTCMonth() + 1) });
  const closePeriod = useMutation({
    mutationFn: (body: { year: number; month: number }) => apiPost("/gl/periods/close", body),
    onSuccess: () => { invalidateAll(); toast("Dönem kapatıldı.", "success"); },
    onError: fail("Dönem kapatılamadı."),
  });
  const reopenPeriod = useMutation({
    mutationFn: (body: { year: number; month: number }) => apiPost("/gl/periods/reopen", body),
    onSuccess: () => { invalidateAll(); toast("Dönem yeniden açıldı.", "success"); },
    onError: fail("Dönem açılamadı."),
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: "entries", label: "Yevmiye" },
    { key: "trial-balance", label: "Mizan" },
    { key: "accounts", label: "Hesap Planı" },
    { key: "periods", label: "Mali Dönemler" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Genel Muhasebe (GL)</h1>
          <p className="text-sm text-slate-500">Çift taraflı kayıt: taslak → kayıt → gerekirse ters kayıt. AR/AP faturaları ve ödemeleri otomatik yevmiyeleşir.</p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>Alt defterleri senkronla</Button>
            <Button onClick={() => setNewOpen(true)}><Plus className="mr-1 inline h-4 w-4" />Yeni yevmiye</Button>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.key} className={`px-3 py-2 text-sm ${tab === t.key ? "border-b-2 border-brand-600 font-medium text-brand-700" : "text-slate-500 hover:text-slate-700"}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "entries" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="gl-status">Durum</Label>
            <Select id="gl-status" className="w-48" value={entryStatus} onChange={(e) => setEntryStatus(e.target.value)}>
              <option value="">Tümü</option>
              <option value="DRAFT">Taslak</option>
              <option value="POSTED">Kayıtlı</option>
              <option value="REVERSED">Ters kayıtlı</option>
            </Select>
          </div>
          <Table headers={["No", "Tarih", "Açıklama", "Kaynak", "Tutar", "Durum"]}>
            {(entries.data ?? []).map((e) => (
              <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(e)}>
                <td className="px-4 py-3 font-medium">{e.jeNo}</td>
                <td className="px-4 py-3">{fmtDate(e.entryDate)}</td>
                <td className="px-4 py-3">{e.description}</td>
                <td className="px-4 py-3 text-slate-500">{SOURCE_LABELS[e.sourceType] ?? e.sourceType}</td>
                <td className="px-4 py-3">{fmtMoney(entryTotal(e))}</td>
                <td className="px-4 py-3"><span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[e.status]}`}>{STATUS_LABELS[e.status]}</span></td>
              </tr>
            ))}
            {(entries.data ?? []).length === 0 && (
              <tr><td className="px-4 py-6 text-center text-slate-400" colSpan={6}>Yevmiye kaydı yok. Hesap planını yükleyip alt defterleri senkronlayın ya da manuel kayıt girin.</td></tr>
            )}
          </Table>
        </div>
      )}

      {tab === "trial-balance" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div><Label htmlFor="tb-from">Başlangıç</Label><Input id="tb-from" type="date" value={tbFrom} onChange={(e) => setTbFrom(e.target.value)} /></div>
            <div><Label htmlFor="tb-to">Bitiş</Label><Input id="tb-to" type="date" value={tbTo} onChange={(e) => setTbTo(e.target.value)} /></div>
          </div>
          <Table headers={["Hesap", "Ad", "Tür", "Açılış", "Borç", "Alacak", "Kapanış"]}>
            {(trialBalance.data?.rows ?? []).map((r) => (
              <tr key={r.accountId}>
                <td className="px-4 py-3 font-medium">{r.code}</td>
                <td className="px-4 py-3">{r.name}</td>
                <td className="px-4 py-3 text-slate-500">{TYPE_LABELS[r.type]}</td>
                <td className="px-4 py-3">{fmtMoney(r.openingBalance)}</td>
                <td className="px-4 py-3">{fmtMoney(r.periodDebit)}</td>
                <td className="px-4 py-3">{fmtMoney(r.periodCredit)}</td>
                <td className="px-4 py-3 font-medium">{fmtMoney(r.closingBalance)}</td>
              </tr>
            ))}
            {trialBalance.data && (
              <tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-3" colSpan={3}>Toplam</td>
                <td className="px-4 py-3">{fmtMoney(trialBalance.data.totals.openingBalance)}</td>
                <td className="px-4 py-3">{fmtMoney(trialBalance.data.totals.periodDebit)}</td>
                <td className="px-4 py-3">{fmtMoney(trialBalance.data.totals.periodCredit)}</td>
                <td className="px-4 py-3">{fmtMoney(trialBalance.data.totals.closingBalance)}</td>
              </tr>
            )}
          </Table>
          {trialBalance.data && trialBalance.data.totals.periodDebit !== trialBalance.data.totals.periodCredit && (
            <p className="text-sm text-red-600">Uyarı: dönem borç ve alacak toplamları eşit değil — kayıtlı yevmiyeler dengesiz.</p>
          )}
        </div>
      )}

      {tab === "accounts" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {isAdmin && <Button variant="outline" disabled={seedDefault.isPending} onClick={() => seedDefault.mutate()}>Varsayılan hesap planını yükle</Button>}
            {canWrite && <Button onClick={() => setAccOpen(true)}><Plus className="mr-1 inline h-4 w-4" />Hesap ekle</Button>}
          </div>
          <Table headers={["Kod", "Ad", "Tür", "Üst hesap", "Kayıt", "Hareket"]}>
            {(accounts.data ?? []).map((a) => (
              <tr key={a.id} className={a.isActive ? "" : "opacity-50"}>
                <td className="px-4 py-3 font-medium">{a.code}</td>
                <td className="px-4 py-3">{a.name}</td>
                <td className="px-4 py-3 text-slate-500">{TYPE_LABELS[a.type]}</td>
                <td className="px-4 py-3 text-slate-500">{a.parent ? `${a.parent.code} ${a.parent.name}` : "—"}</td>
                <td className="px-4 py-3 text-xs">{a.postingAllowed ? "Yaprak" : "Ana hesap"}{!a.isActive && " · pasif"}</td>
                <td className="px-4 py-3">{a._count.lines}</td>
              </tr>
            ))}
            {(accounts.data ?? []).length === 0 && <tr><td className="px-4 py-6 text-center text-slate-400" colSpan={6}>Hesap planı boş.</td></tr>}
          </Table>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Alt defter hesap eşlemesi</h2>
            <p className="mb-3 text-xs text-slate-500">AR/AP belgeleri bu hesaplara yevmiyeleşir. Eşleme eksikse senkron o belgeyi "hesap eşlemesi eksik" nedeniyle atlar.</p>
            <div className="grid gap-2 md:grid-cols-2">
              {Object.keys(KEY_LABELS).map((key) => {
                const current = (postingAccounts.data ?? []).find((p) => p.key === key);
                return (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    <div className="w-40 shrink-0"><Label htmlFor={`map-${key}`}>{KEY_LABELS[key]}</Label></div>
                    <Select id={`map-${key}`} value={current?.account.id ?? ""} disabled={!isAdmin} onChange={(e) => e.target.value && setPosting.mutate({ key, accountId: e.target.value })}>
                      <option value="">— eşlenmedi —</option>
                      {leafAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                    </Select>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {tab === "periods" && (
        <div className="space-y-3">
          {isAdmin && (
            <div className="flex flex-wrap items-end gap-2">
              <div><Label htmlFor="p-year">Yıl</Label><Input id="p-year" type="number" className="w-28" value={periodForm.year} onChange={(e) => setPeriodForm({ ...periodForm, year: e.target.value })} /></div>
              <div><Label htmlFor="p-month">Ay</Label><Input id="p-month" type="number" min={1} max={12} className="w-20" value={periodForm.month} onChange={(e) => setPeriodForm({ ...periodForm, month: e.target.value })} /></div>
              <Button variant="outline" onClick={() => closePeriod.mutate({ year: Number(periodForm.year), month: Number(periodForm.month) })}>Dönemi kapat</Button>
            </div>
          )}
          <Table headers={["Dönem", "Durum", "Kapatan", "Kapanış", ""]}>
            {(periods.data ?? []).map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium">{p.year}-{String(p.month).padStart(2, "0")}</td>
                <td className="px-4 py-3"><span className={`rounded px-2 py-0.5 text-xs ${p.status === "OPEN" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>{p.status === "OPEN" ? "Açık" : "Kapalı"}</span></td>
                <td className="px-4 py-3">{p.closedBy?.name ?? "—"}</td>
                <td className="px-4 py-3">{fmtDate(p.closedAt)}</td>
                <td className="px-4 py-3 text-right">
                  {isAdmin && p.status === "CLOSED" && <Button size="sm" variant="outline" onClick={() => reopenPeriod.mutate({ year: p.year, month: p.month })}>Yeniden aç</Button>}
                </td>
              </tr>
            ))}
            {(periods.data ?? []).length === 0 && <tr><td className="px-4 py-6 text-center text-slate-400" colSpan={5}>Dönemler ilk kayıtla birlikte otomatik açılır.</td></tr>}
          </Table>
        </div>
      )}

      <Modal open={newOpen} title="Yeni yevmiye (taslak)" onClose={() => setNewOpen(false)}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="je-date">Tarih</Label><Input id="je-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
            <div><Label htmlFor="je-desc">Açıklama</Label><Input id="je-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <Select aria-label={`Satır ${i + 1} hesap`} className="col-span-5" value={l.accountId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}>
                  <option value="">Hesap seçin</option>
                  {leafAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </Select>
                <Input aria-label={`Satır ${i + 1} borç`} className="col-span-3" type="number" min={0} step="0.01" placeholder="Borç" value={l.debit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: e.target.value ? "" : x.credit } : x)))} />
                <Input aria-label={`Satır ${i + 1} alacak`} className="col-span-3" type="number" min={0} step="0.01" placeholder="Alacak" value={l.credit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: e.target.value ? "" : x.debit } : x)))} />
                <button type="button" aria-label={`Satır ${i + 1} sil`} className="col-span-1 text-slate-400 hover:text-red-600" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setLines([...lines, emptyLine()])}>+ Satır ekle</Button>
          </div>
          <div className={`text-sm ${balanced ? "text-emerald-700" : "text-red-600"}`}>
            Borç {fmtMoney(draftDebit)} · Alacak {fmtMoney(draftCredit)} {balanced ? "— dengeli" : "— dengeli değil"}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewOpen(false)}>Vazgeç</Button>
            <Button disabled={!balanced || !description || createEntry.isPending || lines.some((l) => !l.accountId)} onClick={() => createEntry.mutate()}>Taslak oluştur</Button>
          </div>
        </div>
      </Modal>

      <Modal open={accOpen} title="Yeni hesap" onClose={() => setAccOpen(false)}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="acc-code">Kod</Label><Input id="acc-code" value={accForm.code} onChange={(e) => setAccForm({ ...accForm, code: e.target.value })} /></div>
            <div><Label htmlFor="acc-name">Ad</Label><Input id="acc-name" value={accForm.name} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} /></div>
            <div>
              <Label htmlFor="acc-type">Tür</Label>
              <Select id="acc-type" value={accForm.type} onChange={(e) => setAccForm({ ...accForm, type: e.target.value as AccountType })}>
                {(Object.keys(TYPE_LABELS) as AccountType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="acc-parent">Üst hesap</Label>
              <Select id="acc-parent" value={accForm.parentId} onChange={(e) => setAccForm({ ...accForm, parentId: e.target.value })}>
                <option value="">—</option>
                {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={accForm.postingAllowed} onChange={(e) => setAccForm({ ...accForm, postingAllowed: e.target.checked })} />
            Kayıt yapılabilir (yaprak hesap)
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAccOpen(false)}>Vazgeç</Button>
            <Button disabled={!accForm.code || !accForm.name || createAccount.isPending} onClick={() => createAccount.mutate()}>Ekle</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!selected} title={selected ? `${selected.jeNo} — ${STATUS_LABELS[selected.status]}` : ""} onClose={() => setSelected(null)}>
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-slate-600">
              <div>Tarih: <span className="text-slate-900">{fmtDate(selected.entryDate)}</span></div>
              <div>Kaynak: <span className="text-slate-900">{SOURCE_LABELS[selected.sourceType] ?? selected.sourceType}</span></div>
              <div className="col-span-2">Açıklama: <span className="text-slate-900">{selected.description}</span></div>
              <div>Oluşturan: {selected.createdBy.name}</div>
              <div>Kaydeden: {selected.postedBy?.name ?? "—"}</div>
              {selected.reversalOf && <div className="col-span-2">Ters kaydı: <span className="font-medium">{selected.reversalOf.jeNo}</span></div>}
              {selected.reversal && <div className="col-span-2">Ters kayıtla kapatıldı: <span className="font-medium">{selected.reversal.jeNo}</span></div>}
            </div>
            <Table headers={["#", "Hesap", "Borç", "Alacak"]}>
              {selected.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2">{l.lineNo}</td>
                  <td className="px-4 py-2">{l.account.code} {l.account.name}{l.description ? ` — ${l.description}` : ""}</td>
                  <td className="px-4 py-2">{Number(l.debit) > 0 ? fmtMoney(l.debit) : ""}</td>
                  <td className="px-4 py-2">{Number(l.credit) > 0 ? fmtMoney(l.credit) : ""}</td>
                </tr>
              ))}
            </Table>
            {canWrite && (
              <div className="flex justify-end gap-2">
                {selected.status === "DRAFT" && <Button variant="danger" onClick={() => deleteDraft.mutate(selected.id)}>Taslağı sil</Button>}
                {selected.status === "DRAFT" && <Button onClick={() => postEntry.mutate(selected.id)}>Kaydet (post)</Button>}
                {selected.status === "POSTED" && <Button variant="outline" onClick={() => reverseEntry.mutate(selected.id)}>Ters kayıt oluştur</Button>}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
