import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Factory, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtMoney, fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { QUOTE_STATUS, StatusBadge } from "../components/status";
import { Button, Card, Input, Label, Modal, Select, Table } from "../components/ui";
import { useConfirm } from "../components/confirm-dialog";
import { useToast } from "../components/toast";
import { quoteTotal } from "./quotes";

interface PartOption {
  id: string;
  partNo: string;
  revision: string;
  name: string;
}
interface QuoteLine {
  id: string;
  quantity: string;
  unitPrice: string;
  dueDate: string;
  part: PartOption;
  workOrders: { id: string; woNo: string }[];
  salesOrderLines: { id: string; salesOrderId: string }[];
}
interface QuoteDetail {
  id: string;
  quoteNo: string;
  status: "DRAFT" | "SENT" | "APPROVED" | "REJECTED";
  currency: string;
  validUntil?: string | null;
  notes?: string | null;
  createdAt: string;
  customer: { id: string; name: string };
  lines: QuoteLine[];
}
interface LineForm {
  partId: string;
  quantity: string;
  unitPrice: string;
  dueDate: string;
}

export function QuoteDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canSales = !!user && ["ADMIN", "SALES"].includes(user.role);
  const canConvert = !!user && ["ADMIN", "PLANNER"].includes(user.role);

  const [lineModal, setLineModal] = useState<{ mode: "create" } | { mode: "edit"; line: QuoteLine } | null>(null);
  const [lineForm, setLineForm] = useState<LineForm>({ partId: "", quantity: "", unitPrice: "", dueDate: "" });
  const [convertOpen, setConvertOpen] = useState(false);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useInvalidateOn(["quote.updated", "salesorder.updated"], ["/quotes"]);

  const query = useQuery({
    queryKey: ["/quotes", id],
    queryFn: () => apiGet<QuoteDetail>(`/quotes/${id}`),
  });
  const parts = useQuery({
    queryKey: ["/parts"],
    queryFn: () => apiGet<PartOption[]>("/parts"),
    enabled: lineModal !== null,
  });

  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["/quotes"] });
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      const msg = (e.body as { message?: string } | null)?.message;
      toast(msg ?? "İşlem çakışması (409)", "error");
    } else toast("İşlem başarısız.", "error");
  };

  const setStatus = useMutation({
    mutationFn: (status: string) => apiPatch(`/quotes/${id}/status`, { status }),
    onSuccess: invalidate,
    onError,
  });
  const removeQuote = useMutation({
    mutationFn: () => apiDelete(`/quotes/${id}`),
    onSuccess: () => {
      invalidate();
      navigate("/quotes");
    },
    onError,
  });
  const saveLine = useMutation({
    mutationFn: () => {
      const payload = {
        partId: lineForm.partId,
        quantity: Number(lineForm.quantity),
        unitPrice: Number(lineForm.unitPrice),
        dueDate: lineForm.dueDate,
      };
      if (lineModal?.mode === "edit")
        return apiPatch(`/quotes/${id}/lines/${lineModal.line.id}`, payload);
      return apiPost(`/quotes/${id}/lines`, payload);
    },
    onSuccess: () => {
      invalidate();
      setLineModal(null);
    },
    onError: (e) =>
      setErr(e instanceof ApiError && e.status === 400 ? "Doğrulama hatası" : "Kaydedilemedi"),
  });
  const removeLine = useMutation({
    mutationFn: (lineId: string) => apiDelete(`/quotes/${id}/lines/${lineId}`),
    onSuccess: invalidate,
    onError,
  });
  const convert = useMutation({
    mutationFn: () =>
      apiPost<{ salesOrder: { id: string; soNo: string } }>(`/quotes/${id}/convert`, {
        lineIds: selectedLines,
      }),
    onSuccess: (res) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["/sales-orders"] });
      setConvertOpen(false);
      toast(`Satış siparişi oluşturuldu: ${res.salesOrder.soNo}`, "success");
      navigate("/sales-orders");
    },
    onError,
  });

  if (query.isLoading) return <p className="text-slate-500">Yükleniyor…</p>;
  if (query.error || !query.data) return <p className="text-red-600">Teklif alınamadı.</p>;
  const quote = query.data;
  const isDraft = quote.status === "DRAFT";

  function openLineCreate() {
    setLineForm({ partId: "", quantity: "", unitPrice: "", dueDate: "" });
    setErr(null);
    setLineModal({ mode: "create" });
  }
  function openLineEdit(line: QuoteLine) {
    setLineForm({
      partId: line.part.id,
      quantity: String(Number(line.quantity)),
      unitPrice: String(Number(line.unitPrice)),
      dueDate: line.dueDate.slice(0, 10),
    });
    setErr(null);
    setLineModal({ mode: "edit", line });
  }
  function openConvert() {
    setSelectedLines(quote.lines.filter((l) => l.salesOrderLines.length === 0).map((l) => l.id));
    setConvertOpen(true);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="px-2" onClick={() => navigate("/quotes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">{quote.quoteNo}</h1>
          <StatusBadge map={QUOTE_STATUS} status={quote.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {canSales && isDraft && (
            <>
              <Button onClick={() => setStatus.mutate("SENT")} disabled={setStatus.isPending}>
                <Send className="h-4 w-4" /> Gönder
              </Button>
              {user?.role === "ADMIN" && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (await confirm({ message: "Taslak teklifi silmek istediğinize emin misiniz?", danger: true }))
                      removeQuote.mutate();
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Sil
                </Button>
              )}
            </>
          )}
          {canSales && quote.status === "SENT" && (
            <>
              <Button onClick={() => setStatus.mutate("APPROVED")} disabled={setStatus.isPending}>
                Onayla
              </Button>
              <Button
                variant="danger"
                onClick={() => setStatus.mutate("REJECTED")}
                disabled={setStatus.isPending}
              >
                Reddet
              </Button>
            </>
          )}
          {canConvert && quote.status === "APPROVED" && (
            <Button onClick={openConvert}>
              <Factory className="h-4 w-4" /> Satış Siparişine Dönüştür
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <div className="text-xs uppercase text-slate-500">Müşteri</div>
          <div className="mt-1 font-medium">{quote.customer.name}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Toplam</div>
          <div className="mt-1 font-medium">{fmtMoney(quoteTotal(quote.lines), quote.currency)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Geçerlilik</div>
          <div className="mt-1 font-medium">{fmtDate(quote.validUntil)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Oluşturma</div>
          <div className="mt-1 font-medium">{fmtDate(quote.createdAt)}</div>
        </Card>
      </div>

      {quote.notes && (
        <Card className="mb-6">
          <div className="text-xs uppercase text-slate-500">Notlar</div>
          <div className="mt-1 text-sm">{quote.notes}</div>
        </Card>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Satırlar</h2>
        {canSales && isDraft && (
          <Button variant="outline" onClick={openLineCreate}>
            <Plus className="h-4 w-4" /> Satır Ekle
          </Button>
        )}
      </div>
      <Table
        headers={[
          "Parça",
          "Miktar",
          "Birim Fiyat",
          "Tutar",
          "Termin",
          "Satış Siparişi",
          ...(canSales && isDraft ? ["İşlem"] : []),
        ]}
      >
        {quote.lines.map((l) => (
          <tr key={l.id} className="hover:bg-slate-50">
            <td className="px-4 py-3">
              {l.part.partNo} rev{l.part.revision} — {l.part.name}
            </td>
            <td className="px-4 py-3">{fmtQty(l.quantity)}</td>
            <td className="px-4 py-3">{fmtMoney(l.unitPrice, quote.currency)}</td>
            <td className="px-4 py-3">
              {fmtMoney(Number(l.quantity) * Number(l.unitPrice), quote.currency)}
            </td>
            <td className="px-4 py-3">{fmtDate(l.dueDate)}</td>
            <td className="px-4 py-3">
              {l.salesOrderLines.length === 0 ? (
                "—"
              ) : (
                <Link to="/sales-orders" className="text-brand-700 hover:underline">
                  Siparişte
                </Link>
              )}
            </td>
            {canSales && isDraft && (
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  <Button variant="ghost" className="px-2 py-1" onClick={() => openLineEdit(l)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-red-600"
                    onClick={async () => {
                      if (await confirm({ message: "Satırı silmek istediğinize emin misiniz?", danger: true }))
                        removeLine.mutate(l.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </td>
            )}
          </tr>
        ))}
      </Table>

      <Modal
        open={lineModal !== null}
        title={lineModal?.mode === "edit" ? "Satır Düzenle" : "Satır Ekle"}
        onClose={() => setLineModal(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveLine.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="part">Parça</Label>
            <Select
              id="part"
              required
              value={lineForm.partId}
              onChange={(e) => setLineForm({ ...lineForm, partId: e.target.value })}
            >
              <option value="">Seçin…</option>
              {parts.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partNo} rev{p.revision} — {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="qty">Miktar</Label>
              <Input
                id="qty"
                type="number"
                step="any"
                min="0.001"
                required
                value={lineForm.quantity}
                onChange={(e) => setLineForm({ ...lineForm, quantity: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="price">Birim Fiyat</Label>
              <Input
                id="price"
                type="number"
                step="any"
                min="0"
                required
                value={lineForm.unitPrice}
                onChange={(e) => setLineForm({ ...lineForm, unitPrice: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="due">Termin</Label>
              <Input
                id="due"
                type="date"
                required
                value={lineForm.dueDate}
                onChange={(e) => setLineForm({ ...lineForm, dueDate: e.target.value })}
              />
            </div>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setLineModal(null)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={saveLine.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={convertOpen} title="Satış Siparişine Dönüştür" onClose={() => setConvertOpen(false)}>
        <p className="mb-3 text-sm text-slate-600">
          Satış siparişine dahil edilecek satırları seçin. Zaten dönüştürülmüş satırlar seçilemez.
        </p>
        <div className="mb-4 space-y-2">
          {quote.lines.map((l) => {
            const converted = l.salesOrderLines.length > 0;
            return (
              <label
                key={l.id}
                className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  disabled={converted}
                  checked={selectedLines.includes(l.id)}
                  onChange={(e) =>
                    setSelectedLines((ids) =>
                      e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id),
                    )
                  }
                />
                <span className={converted ? "text-slate-400" : ""}>
                  {l.part.partNo} — {fmtQty(l.quantity)} adet, termin {fmtDate(l.dueDate)}
                  {converted && " (siparişte)"}
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConvertOpen(false)}>
            Vazgeç
          </Button>
          <Button
            disabled={selectedLines.length === 0 || convert.isPending}
            onClick={() => convert.mutate()}
          >
            {convert.isPending ? "Dönüştürülüyor…" : `${selectedLines.length} Satırı Dönüştür`}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
