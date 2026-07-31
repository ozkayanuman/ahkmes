import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { PO_STATUS, StatusBadge } from "../components/status";
import { Button, Input, Label, Modal, Select, Table } from "../components/ui";
import { todayInput } from "../lib/format";

interface Option {
  id: string;
  name: string;
}
interface MaterialOption {
  id: string;
  code: string;
  name: string;
  unit: string;
}
export interface PoLine {
  id: string;
  quantity: string;
  unitPrice: string;
  receivedQty: string;
  material: { id: string; code: string; name: string; unit: string; stockQty: string };
}
export interface PoRow {
  id: string;
  poNo: string;
  status: string;
  orderDate: string;
  expectedDate?: string | null;
  notes?: string | null;
  supplier: { id: string; name: string };
  lines: PoLine[];
}
interface LineDraft {
  materialId: string;
  quantity: string;
  unitPrice: string;
}

const emptyLine = (): LineDraft => ({ materialId: "", quantity: "", unitPrice: "" });

export function PurchaseOrdersPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [currency, setCurrency] = useState("TRY");
  const [orderDate, setOrderDate] = useState(todayInput());
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [err, setErr] = useState<string | null>(null);

  useInvalidateOn(["purchaseorder.updated"], ["/purchase-orders"]);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const query = useQuery({
    queryKey: ["/purchase-orders", q, status],
    queryFn: () => apiGet<PoRow[]>(`/purchase-orders?${params.toString()}`),
  });
  const suppliers = useQuery({
    queryKey: ["/suppliers"],
    queryFn: () => apiGet<Option[]>("/suppliers"),
    enabled: open,
  });
  const materials = useQuery({
    queryKey: ["/materials"],
    queryFn: () => apiGet<MaterialOption[]>("/materials"),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<PoRow>("/purchase-orders", {
        supplierId,
        currency,
        orderDate,
        ...(expectedDate ? { expectedDate } : {}),
        ...(notes ? { notes } : {}),
        lines: lines.map((l) => ({
          materialId: l.materialId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
        })),
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["/purchase-orders"] });
      setOpen(false);
      navigate(`/purchase-orders/${created.id}`);
    },
    onError: (e) =>
      setErr(
        e instanceof ApiError && e.status === 400
          ? "Doğrulama hatası: satır alanlarını kontrol edin"
          : "Kaydedilemedi",
      ),
  });

  function receivedRatio(row: PoRow) {
    const total = row.lines.reduce((s, l) => s + Number(l.quantity), 0);
    const received = row.lines.reduce((s, l) => s + Number(l.receivedQty), 0);
    return `${fmtQty(received)} / ${fmtQty(total)}`;
  }

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Satınalma</h1>
        {canWrite && (
          <Button
            onClick={() => {
              setSupplierId("");
              setCurrency("TRY");
              setOrderDate(todayInput());
              setExpectedDate("");
              setNotes("");
              setLines([emptyLine()]);
              setErr(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Yeni Sipariş
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Sipariş no veya tedarikçi ara…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-48">
          <option value="">Tüm Durumlar</option>
          {Object.entries(PO_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {query.error && <p className="text-red-600">Liste alınamadı.</p>}

      {query.data && (
        <Table headers={["Sipariş No", "Tedarikçi", "Durum", "Sipariş Tarihi", "Beklenen", "Teslimat"]}>
          {query.data.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                Kayıt yok
              </td>
            </tr>
          )}
          {query.data.map((row) => (
            <tr
              key={row.id}
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => navigate(`/purchase-orders/${row.id}`)}
            >
              <td className="px-4 py-3 font-medium text-brand-700">{row.poNo}</td>
              <td className="px-4 py-3">{row.supplier.name}</td>
              <td className="px-4 py-3">
                <StatusBadge map={PO_STATUS} status={row.status} />
              </td>
              <td className="px-4 py-3">{fmtDate(row.orderDate)}</td>
              <td className="px-4 py-3">{fmtDate(row.expectedDate)}</td>
              <td className="px-4 py-3">{receivedRatio(row)}</td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={open} title="Yeni Satınalma Siparişi" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="supplier">Tedarikçi</Label>
            <Select
              id="supplier"
              required
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Seçin…</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="orderDate">Sipariş Tarihi</Label>
              <Input
                id="orderDate"
                type="date"
                required
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="expectedDate">Beklenen Teslim</Label>
              <Input
                id="expectedDate"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
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
                      value={l.materialId}
                      onChange={(e) => setLine(i, { materialId: e.target.value })}
                    >
                      <option value="">Malzeme…</option>
                      {materials.data?.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.code} — {m.name} ({m.unit})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Input
                    className="w-24"
                    type="number"
                    step="any"
                    min="0.001"
                    placeholder="Miktar"
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
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
