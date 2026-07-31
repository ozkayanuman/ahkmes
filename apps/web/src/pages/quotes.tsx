import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtMoney } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Teklifler</h1>
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Yeni Teklif
          </Button>
        )}
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
                      onChange={(e) => setLine(i, { partId: e.target.value })}
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
    </div>
  );
}
