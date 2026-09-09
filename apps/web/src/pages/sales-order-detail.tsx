import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Package, Receipt, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtMoney, fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { SALES_ORDER_STATUS, StatusBadge } from "../components/status";
import { Button, Card, Input, Modal, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";

interface SalesOrderLine {
  id: string;
  quantity: string;
  unitPrice: string;
  shippedQty: string;
  invoicedQty: string;
  dueDate: string;
  part: { id: string; partNo: string; name: string };
}
interface SalesOrderDetail {
  id: string;
  soNo: string;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  currency: string;
  createdAt: string;
  customer: { id: string; name: string };
  quote: { id: string; quoteNo: string } | null;
  lines: SalesOrderLine[];
}
interface DeliveryRow {
  id: string;
  dlvNo: string;
  shippedDate: string;
  lines: { id: string; qty: string; salesOrderLine: { id: string; part: { partNo: string } } }[];
}
interface InvoiceRow {
  id: string;
  invNo: string;
  status: "ISSUED" | "CANCELLED";
  issuedDate: string;
  lines: { id: string; qty: string; unitPrice: string; salesOrderLine: { id: string; part: { partNo: string } } }[];
}
type LineQty = Record<string, string>;
interface BinOption { id: string; code: string; warehouse: { name: string } }

export function SalesOrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const toast = useToast();
  const canDeliver = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const canInvoice = !!user && ["ADMIN", "SALES"].includes(user.role);

  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliverQty, setDeliverQty] = useState<LineQty>({});
  const [deliveryBinId, setDeliveryBinId] = useState("");
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceQty, setInvoiceQty] = useState<LineQty>({});

  useInvalidateOn(
    ["salesorder.updated", "delivery.created", "invoice.created", "invoice.updated"],
    ["/sales-orders", "/deliveries", "/invoices"],
  );

  const query = useQuery({
    queryKey: ["/sales-orders", id],
    queryFn: () => apiGet<SalesOrderDetail>(`/sales-orders/${id}`),
  });
  const deliveries = useQuery({
    queryKey: ["/deliveries", id],
    queryFn: () => apiGet<DeliveryRow[]>(`/deliveries?salesOrderId=${id}`),
  });
  const invoices = useQuery({
    queryKey: ["/invoices", id],
    queryFn: () => apiGet<InvoiceRow[]>(`/invoices?salesOrderId=${id}`),
  });
  const bins = useQuery({ queryKey: ["/bins"], queryFn: () => apiGet<BinOption[]>("/bins"), enabled: canDeliver });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["/sales-orders", id] });
    qc.invalidateQueries({ queryKey: ["/deliveries", id] });
    qc.invalidateQueries({ queryKey: ["/invoices", id] });
  };

  const createDelivery = useMutation({
    mutationFn: () =>
      apiPost(`/deliveries`, {
        salesOrderId: id,
        lines: Object.entries(deliverQty)
          .filter(([, qty]) => Number(qty) > 0)
          .map(([salesOrderLineId, qty]) => ({ salesOrderLineId, qty: Number(qty), ...(deliveryBinId ? { binId: deliveryBinId } : {}) })),
      }),
    onSuccess: () => {
      invalidateAll();
      setDeliverOpen(false);
      setDeliveryBinId("");
      toast("Sevkiyat oluşturuldu", "success");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Sevkiyat oluşturulamadı", "error");
    },
  });

  const createInvoice = useMutation({
    mutationFn: () =>
      apiPost(`/invoices`, {
        salesOrderId: id,
        lines: Object.entries(invoiceQty)
          .filter(([, qty]) => Number(qty) > 0)
          .map(([salesOrderLineId, qty]) => ({ salesOrderLineId, qty: Number(qty) })),
      }),
    onSuccess: () => {
      invalidateAll();
      setInvoiceOpen(false);
      toast("Fatura kesildi", "success");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Fatura kesilemedi", "error");
    },
  });

  const cancelInvoice = useMutation({
    mutationFn: (invId: string) => apiPatch(`/invoices/${invId}/cancel`, {}),
    onSuccess: invalidateAll,
    onError: () => toast("Fatura iptal edilemedi", "error"),
  });

  if (query.isLoading) return <p className="text-slate-500">Yükleniyor…</p>;
  if (query.error || !query.data) return <p className="text-red-600">Sipariş alınamadı.</p>;
  const so = query.data;

  function openDeliver() {
    const init: LineQty = {};
    for (const l of so.lines) {
      const remaining = Number(l.quantity) - Number(l.shippedQty);
      if (remaining > 0) init[l.id] = String(remaining);
    }
    setDeliverQty(init);
    setDeliverOpen(true);
  }
  function openInvoice() {
    const init: LineQty = {};
    for (const l of so.lines) {
      const remaining = Number(l.shippedQty) - Number(l.invoicedQty);
      if (remaining > 0) init[l.id] = String(remaining);
    }
    setInvoiceQty(init);
    setInvoiceOpen(true);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="px-2" onClick={() => navigate("/sales-orders")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">{so.soNo}</h1>
          <StatusBadge map={SALES_ORDER_STATUS} status={so.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {canDeliver && so.status === "OPEN" && (
            <Button onClick={openDeliver}>
              <Package className="h-4 w-4" /> Sevkiyat Oluştur
            </Button>
          )}
          {canInvoice && so.status === "OPEN" && (
            <Button onClick={openInvoice}>
              <Receipt className="h-4 w-4" /> Fatura Kes
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card>
          <div className="text-xs uppercase text-slate-500">Müşteri</div>
          <div className="mt-1 font-medium">{so.customer.name}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Kaynak Teklif</div>
          <div className="mt-1 font-medium">
            {so.quote ? (
              <Link to={`/quotes/${so.quote.id}`} className="text-brand-700 hover:underline">
                {so.quote.quoteNo}
              </Link>
            ) : (
              "—"
            )}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Oluşturma</div>
          <div className="mt-1 font-medium">{fmtDate(so.createdAt)}</div>
        </Card>
      </div>

      <h2 className="mb-3 text-lg font-semibold">Satırlar</h2>
      <Table headers={["Parça", "Miktar", "Sevk Edilen", "Faturalanan", "Termin"]}>
        {so.lines.map((l) => (
          <tr key={l.id}>
            <td className="px-4 py-3">
              {l.part.partNo} — {l.part.name}
            </td>
            <td className="px-4 py-3">{fmtQty(l.quantity)}</td>
            <td className="px-4 py-3">
              {fmtQty(l.shippedQty)} / {fmtQty(l.quantity)}
            </td>
            <td className="px-4 py-3">
              {fmtQty(l.invoicedQty)} / {fmtQty(l.shippedQty)}
            </td>
            <td className="px-4 py-3">{fmtDate(l.dueDate)}</td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-3 mt-6 text-lg font-semibold">Sevkiyatlar</h2>
      <Table headers={["No", "Tarih", "Satırlar"]}>
        {(deliveries.data ?? []).length === 0 && (
          <tr>
            <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
              Sevkiyat yok.
            </td>
          </tr>
        )}
        {(deliveries.data ?? []).map((d) => (
          <tr key={d.id}>
            <td className="px-4 py-3 font-medium">{d.dlvNo}</td>
            <td className="px-4 py-3">{fmtDate(d.shippedDate)}</td>
            <td className="px-4 py-3 text-xs text-slate-500">
              {d.lines.map((l) => `${l.salesOrderLine.part.partNo}: ${fmtQty(l.qty)}`).join(", ")}
            </td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-3 mt-6 text-lg font-semibold">Faturalar</h2>
      <Table headers={["No", "Durum", "Tarih", "Tutar", "İşlem"]}>
        {(invoices.data ?? []).length === 0 && (
          <tr>
            <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
              Fatura yok.
            </td>
          </tr>
        )}
        {(invoices.data ?? []).map((inv) => {
          const total = inv.lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.unitPrice), 0);
          return (
            <tr key={inv.id}>
              <td className="px-4 py-3 font-medium">{inv.invNo}</td>
              <td className="px-4 py-3">
                <span
                  className={
                    inv.status === "ISSUED"
                      ? "inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700"
                      : "inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700"
                  }
                >
                  {inv.status === "ISSUED" ? "Kesildi" : "İptal"}
                </span>
              </td>
              <td className="px-4 py-3">{fmtDate(inv.issuedDate)}</td>
              <td className="px-4 py-3">{fmtMoney(total, so.currency)}</td>
              <td className="px-4 py-3">
                {canInvoice && inv.status === "ISSUED" && (
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs text-red-600"
                    onClick={() => cancelInvoice.mutate(inv.id)}
                  >
                    <XCircle className="h-4 w-4" /> İptal Et
                  </Button>
                )}
              </td>
            </tr>
          );
        })}
      </Table>

      <Modal open={deliverOpen} title="Sevkiyat Oluştur" onClose={() => setDeliverOpen(false)}>
        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="deliveryBin">Kaynak raf</label>
          <Select id="deliveryBin" value={deliveryBinId} onChange={(e) => setDeliveryBinId(e.target.value)}>
            <option value="">Atanmamış stok</option>
            {bins.data?.map((b) => <option key={b.id} value={b.id}>{b.warehouse.name} / {b.code}</option>)}
          </Select>
        </div>
        <div className="mb-4 space-y-2">
          {so.lines
            .filter((l) => Number(l.quantity) - Number(l.shippedQty) > 0)
            .map((l) => {
              const remaining = Number(l.quantity) - Number(l.shippedQty);
              return (
                <div key={l.id} className="flex items-center gap-3 text-sm">
                  <span className="flex-1">
                    {l.part.partNo} — kalan sevk edilebilir {fmtQty(String(remaining))}
                  </span>
                  <Input
                    className="w-28"
                    type="number"
                    step="any"
                    min="0"
                    max={remaining}
                    value={deliverQty[l.id] ?? ""}
                    onChange={(e) => setDeliverQty((q) => ({ ...q, [l.id]: e.target.value }))}
                  />
                </div>
              );
            })}
          {so.lines.every((l) => Number(l.quantity) - Number(l.shippedQty) <= 0) && (
            <p className="text-sm text-slate-400">Sevk edilebilir satır kalmadı.</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeliverOpen(false)}>
            Vazgeç
          </Button>
          <Button disabled={createDelivery.isPending} onClick={() => createDelivery.mutate()}>
            {createDelivery.isPending ? "Oluşturuluyor…" : "Sevkiyatı Kaydet"}
          </Button>
        </div>
      </Modal>

      <Modal open={invoiceOpen} title="Fatura Kes" onClose={() => setInvoiceOpen(false)}>
        <div className="mb-4 space-y-2">
          {so.lines
            .filter((l) => Number(l.shippedQty) - Number(l.invoicedQty) > 0)
            .map((l) => {
              const remaining = Number(l.shippedQty) - Number(l.invoicedQty);
              return (
                <div key={l.id} className="flex items-center gap-3 text-sm">
                  <span className="flex-1">
                    {l.part.partNo} — kalan faturalanabilir {fmtQty(String(remaining))}
                  </span>
                  <Input
                    className="w-28"
                    type="number"
                    step="any"
                    min="0"
                    max={remaining}
                    value={invoiceQty[l.id] ?? ""}
                    onChange={(e) => setInvoiceQty((q) => ({ ...q, [l.id]: e.target.value }))}
                  />
                </div>
              );
            })}
          {so.lines.every((l) => Number(l.shippedQty) - Number(l.invoicedQty) <= 0) && (
            <p className="text-sm text-slate-400">Faturalanabilir satır kalmadı (önce sevkiyat gerekir).</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setInvoiceOpen(false)}>
            Vazgeç
          </Button>
          <Button disabled={createInvoice.isPending} onClick={() => createInvoice.mutate()}>
            {createInvoice.isPending ? "Kesiliyor…" : "Faturayı Kes"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
