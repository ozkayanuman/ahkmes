import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtMoney } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { useToast } from "../components/toast";
import { QUOTE_STATUS, StatusBadge } from "../components/status";
import { Button, Input, Label, Modal, Select, Table } from "../components/ui";

interface Option {
  id: string;
  name: string;
}
interface PartOption {
  id: string;
  partNo: string;
  revision: string;
  name: string;
}
export interface QuoteRow {
  id: string;
  quoteNo: string;
  status: string;
  currency: string;
  createdAt: string;
  validUntil?: string | null;
  customer: { id: string; name: string };
  lines: { id: string; quantity: string; unitPrice: string }[];
}
interface LineDraft {
  partId: string;
  quantity: string;
  unitPrice: string;
  dueDate: string;
}

const emptyLine = (): LineDraft => ({ partId: "", quantity: "", unitPrice: "", dueDate: "" });

export const quoteTotal = (lines: { quantity: string; unitPrice: string }[]) =>
  lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);

interface PriceListRow {
  id: string;
  name: string;
  currency: string;
  customerId: string | null;
  customer?: { id: string; name: string } | null;
  isActive: boolean;
}
interface PriceListLineRow {
  id: string;
  unitPrice: string;
  discountPercent: string | null;
  part: { id: string; partNo: string; name: string };
}

/** Fiyat listesi/indirim yönetimi — customerId boş "Genel" bir liste, doluysa
 * yalnızca o müşteriye özel ve teklif satırı ekleme formunda önceliklidir. */
function PriceListsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<PriceListRow | null>(null);
  const [newList, setNewList] = useState({ name: "", currency: "TRY", customerId: "" });
  const [lineForm, setLineForm] = useState({ partId: "", unitPrice: "", discountPercent: "" });

  const lists = useQuery({ queryKey: ["/price-lists"], queryFn: () => apiGet<PriceListRow[]>("/price-lists") });
  const customers = useQuery({ queryKey: ["/customers"], queryFn: () => apiGet<Option[]>("/customers") });
  const parts = useQuery({ queryKey: ["/parts"], queryFn: () => apiGet<PartOption[]>("/parts") });
  const lines = useQuery({
    queryKey: ["/price-lists", selected?.id, "lines"],
    queryFn: () => apiGet<PriceListLineRow[]>(`/price-lists/${selected!.id}/lines`),
    enabled: !!selected,
  });

  const createList = useMutation({
    mutationFn: () => apiPost<PriceListRow>("/price-lists", { name: newList.name, currency: newList.currency, ...(newList.customerId ? { customerId: newList.customerId } : {}) }),
    onSuccess: (created) => { qc.invalidateQueries({ queryKey: ["/price-lists"] }); setNewList({ name: "", currency: "TRY", customerId: "" }); setSelected(created); toast("Fiyat listesi oluşturuldu.", "success"); },
    onError: () => toast("Fiyat listesi oluşturulamadı.", "error"),
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => apiPatch(`/price-lists/${id}`, { isActive: false }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/price-lists"] }); toast("Fiyat listesi pasifleştirildi.", "success"); },
    onError: () => toast("İşlem başarısız.", "error"),
  });
  const upsertLine = useMutation({
    mutationFn: () => apiPost(`/price-lists/${selected!.id}/lines`, { partId: lineForm.partId, unitPrice: Number(lineForm.unitPrice), ...(lineForm.discountPercent ? { discountPercent: Number(lineForm.discountPercent) } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/price-lists", selected?.id, "lines"] }); setLineForm({ partId: "", unitPrice: "", discountPercent: "" }); toast("Fiyat satırı kaydedildi.", "success"); },
    onError: () => toast("Fiyat satırı kaydedilemedi.", "error"),
  });
  const removeLine = useMutation({
    mutationFn: (lineId: string) => apiDelete(`/price-lists/${selected!.id}/lines/${lineId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/price-lists", selected?.id, "lines"] }); toast("Fiyat satırı kaldırıldı.", "success"); },
    onError: () => toast("Kaldırılamadı.", "error"),
  });

  return (
    <Modal open title="Fiyat Listeleri" onClose={onClose} className="max-w-3xl">
      <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {lists.data?.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setSelected(l)}
                className={`w-full rounded border px-2 py-1.5 text-left text-sm ${selected?.id === l.id ? "border-brand-400 bg-brand-50" : "border-slate-200"} ${!l.isActive ? "opacity-50" : ""}`}
              >
                <div className="font-medium">{l.name}</div>
                <div className="text-xs text-slate-500">{l.customer?.name ?? "Genel"} · {l.currency}{!l.isActive ? " · pasif" : ""}</div>
              </button>
            ))}
            {lists.data?.length === 0 && <p className="text-xs text-slate-400">Henüz fiyat listesi yok.</p>}
          </div>
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <Input placeholder="Liste adı" value={newList.name} onChange={(e) => setNewList({ ...newList, name: e.target.value })} />
            <Select value={newList.currency} onChange={(e) => setNewList({ ...newList, currency: e.target.value })}>
              <option value="TRY">TRY</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </Select>
            <Select value={newList.customerId} onChange={(e) => setNewList({ ...newList, customerId: e.target.value })}>
              <option value="">Genel (tüm müşteriler)</option>
              {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Button className="w-full" disabled={!newList.name.trim() || createList.isPending} onClick={() => createList.mutate()}>Yeni Liste</Button>
          </div>
        </div>
        <div>
          {!selected ? (
            <p className="text-sm text-slate-400">Satırları görmek için soldan bir liste seçin.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{selected.name}</h3>
                {selected.isActive && <Button size="sm" variant="outline" disabled={deactivate.isPending} onClick={() => deactivate.mutate(selected.id)}>Pasifleştir</Button>}
              </div>
              <div className="grid grid-cols-[1fr_100px_90px_70px] gap-2">
                <Select value={lineForm.partId} onChange={(e) => setLineForm({ ...lineForm, partId: e.target.value })}>
                  <option value="">Parça…</option>
                  {parts.data?.map((p) => <option key={p.id} value={p.id}>{p.partNo} — {p.name}</option>)}
                </Select>
                <Input type="number" step="any" min="0" placeholder="B.Fiyat" value={lineForm.unitPrice} onChange={(e) => setLineForm({ ...lineForm, unitPrice: e.target.value })} />
                <Input type="number" step="any" min="0" max="100" placeholder="İndirim %" value={lineForm.discountPercent} onChange={(e) => setLineForm({ ...lineForm, discountPercent: e.target.value })} />
                <Button disabled={!lineForm.partId || !lineForm.unitPrice || upsertLine.isPending} onClick={() => upsertLine.mutate()}>Ekle</Button>
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto text-sm">
                {lines.data?.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1">
                    <span>{row.part.partNo} — {row.part.name}</span>
                    <span className="flex items-center gap-2 text-slate-600">
                      {fmtMoney(Number(row.unitPrice), selected.currency)}
                      {row.discountPercent && <span className="text-xs text-emerald-600">−%{Number(row.discountPercent)}</span>}
                      <Button size="sm" variant="ghost" className="px-1 py-0.5 text-red-600" onClick={() => removeLine.mutate(row.id)}><Trash2 className="h-3 w-3" /></Button>
                    </span>
                  </div>
                ))}
                {lines.data?.length === 0 && <p className="text-xs text-slate-400">Bu listede fiyat satırı yok.</p>}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end"><Button variant="outline" onClick={onClose}>Kapat</Button></div>
    </Modal>
  );
}

export function QuotesPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "SALES"].includes(user.role);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [currency, setCurrency] = useState("TRY");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [err, setErr] = useState<string | null>(null);
  const [showPriceLists, setShowPriceLists] = useState(false);

  useInvalidateOn(["quote.updated"], ["/quotes"]);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const query = useQuery({
    queryKey: ["/quotes", q, status],
    queryFn: () => apiGet<QuoteRow[]>(`/quotes?${params.toString()}`),
  });
  const customers = useQuery({
    queryKey: ["/customers"],
    queryFn: () => apiGet<Option[]>("/customers"),
    enabled: open,
  });
  const parts = useQuery({
    queryKey: ["/parts"],
    queryFn: () => apiGet<PartOption[]>("/parts"),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<QuoteRow>("/quotes", {
        customerId,
        currency,
        ...(validUntil ? { validUntil } : {}),
        ...(notes ? { notes } : {}),
        lines: lines.map((l) => ({
          partId: l.partId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          dueDate: l.dueDate,
        })),
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["/quotes"] });
      setOpen(false);
      navigate(`/quotes/${created.id}`);
    },
    onError: (e) =>
      setErr(
        e instanceof ApiError && e.status === 400
          ? "Doğrulama hatası: tüm satır alanlarını kontrol edin"
          : "Kaydedilemedi, tekrar deneyin",
      ),
  });

  function openCreate() {
    setCustomerId("");
    setCurrency("TRY");
    setValidUntil("");
    setNotes("");
    setLines([emptyLine()]);
    setErr(null);
    setOpen(true);
  }

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  /** Parça seçilince, müşteriye özel veya genel fiyat listesinden bir öneri
   * çeker — yalnızca birim fiyat henüz boşsa doldurur, elle girilmiş bir
   * değerin üzerine yazmaz. */
  async function applyPriceSuggestion(i: number, partId: string) {
    if (!partId || !customerId) return;
    try {
      const match = await apiGet<{ unitPrice: string; discountPercent: string | null } | null>(
        `/price-lists/resolve?partId=${partId}&customerId=${customerId}`,
      );
      if (!match) return;
      const effective = Number(match.unitPrice) * (1 - Number(match.discountPercent ?? 0) / 100);
      setLines((ls) => ls.map((l, idx) => (idx === i && l.partId === partId && !l.unitPrice ? { ...l, unitPrice: effective.toFixed(2) } : l)));
    } catch {
      // Fiyat önerisi opsiyonel bir kolaylık — bulunamazsa satır elle doldurulmaya devam eder.
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Teklifler</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowPriceLists(true)}>
            <Tags className="h-4 w-4" /> Fiyat Listeleri
          </Button>
          {canWrite && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Yeni Teklif
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Teklif no veya müşteri ara…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-48">
          <option value="">Tüm Durumlar</option>
          {Object.entries(QUOTE_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {query.error && <p className="text-red-600">Liste alınamadı.</p>}

      {query.data && (
        <Table headers={["Teklif No", "Müşteri", "Durum", "Satır", "Toplam", "Geçerlilik", "Tarih"]}>
          {query.data.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                Kayıt yok
              </td>
            </tr>
          )}
          {query.data.map((row) => (
            <tr
              key={row.id}
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => navigate(`/quotes/${row.id}`)}
            >
              <td className="px-4 py-3 font-medium text-brand-700">{row.quoteNo}</td>
              <td className="px-4 py-3">{row.customer.name}</td>
              <td className="px-4 py-3">
                <StatusBadge map={QUOTE_STATUS} status={row.status} />
              </td>
              <td className="px-4 py-3">{row.lines.length}</td>
              <td className="px-4 py-3">{fmtMoney(quoteTotal(row.lines), row.currency)}</td>
              <td className="px-4 py-3">{fmtDate(row.validUntil)}</td>
              <td className="px-4 py-3">{fmtDate(row.createdAt)}</td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={open} title="Yeni Teklif" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="customer">Müşteri</Label>
            <Select
              id="customer"
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Seçin…</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="currency">Para Birimi</Label>
            <Select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="TRY">TRY</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="validUntil">Geçerlilik Tarihi</Label>
            <Input
              id="validUntil"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="notes">Notlar</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Satırlar</Label>
              <Button
                type="button"
                variant="outline"
                className="px-2 py-1 text-xs"
                onClick={() => setLines((ls) => [...ls, emptyLine()])}
              >
                <Plus className="h-3 w-3" /> Satır Ekle
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Select
                      required
                      value={l.partId}
                      onChange={(e) => { setLine(i, { partId: e.target.value }); void applyPriceSuggestion(i, e.target.value); }}
                    >
                      <option value="">Parça…</option>
                      {parts.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.partNo} rev{p.revision} — {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Input
                    className="w-20"
                    type="number"
                    step="any"
                    min="0.001"
                    placeholder="Adet"
                    required
                    value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                  />
                  <Input
                    className="w-24"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="B.Fiyat"
                    required
                    value={l.unitPrice}
                    onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                  />
                  <Input
                    className="w-36"
                    type="date"
                    required
                    value={l.dueDate}
                    onChange={(e) => setLine(i, { dueDate: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-2 py-1 text-red-600"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </Modal>
      {showPriceLists && <PriceListsModal onClose={() => setShowPriceLists(false)} />}
    </div>
  );
}
