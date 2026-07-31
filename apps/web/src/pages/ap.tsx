import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtMoney } from "../lib/format";
import { Button, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

interface SupplierOption {
  id: string;
  name: string;
}
interface PurchaseOrderOption {
  id: string;
  poNo: string;
  supplierId: string;
}
interface PurchaseOrderLineDetail {
  id: string;
  quantity: string;
  receivedQty: string;
  invoicedQty: string;
  unitPrice: string;
  material: { id: string; code: string; name: string };
}
interface PurchaseOrderDetail {
  id: string;
  poNo: string;
  supplierId: string;
  lines: PurchaseOrderLineDetail[];
}
interface SupplierInvoiceRow {
  id: string;
  sinNo: string;
  status: "ISSUED" | "CANCELLED";
  issuedDate: string;
  supplier: { id: string; name: string };
  purchaseOrder: { id: string; poNo: string };
  lines: { qty: string; unitPrice: string }[];
  allocations: { amount: string }[];
}
interface SupplierPaymentRow {
  id: string;
  spNo: string;
  amount: string;
  paymentDate: string;
  supplier: { id: string; name: string };
  allocations: { amount: string; supplierInvoice: { id: string; sinNo: string } }[];
}
interface SummaryRow {
  supplierId: string;
  supplierName: string;
  currency: string;
  outstanding: number;
}

function invoiceTotal(inv: SupplierInvoiceRow) {
  return inv.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
}
function invoiceAllocated(inv: SupplierInvoiceRow) {
  return inv.allocations.reduce((s, a) => s + Number(a.amount), 0);
}

export function ApPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();

  const [invOpen, setInvOpen] = useState(false);
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [invNotes, setInvNotes] = useState("");
  const [lineQty, setLineQty] = useState<Record<string, string>>({});

  const [payOpen, setPayOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [allocAmount, setAllocAmount] = useState<Record<string, string>>({});

  const invoices = useQuery({
    queryKey: ["/ap/invoices"],
    queryFn: () => apiGet<SupplierInvoiceRow[]>("/ap/invoices"),
  });
  const payments = useQuery({
    queryKey: ["/ap/payments"],
    queryFn: () => apiGet<SupplierPaymentRow[]>("/ap/payments"),
  });
  const summary = useQuery({
    queryKey: ["/ap/summary"],
    queryFn: () => apiGet<SummaryRow[]>("/ap/summary"),
  });
  const suppliers = useQuery({
    queryKey: ["/suppliers"],
    queryFn: () => apiGet<SupplierOption[]>("/suppliers"),
    enabled: invOpen || payOpen,
  });
  const purchaseOrders = useQuery({
    queryKey: ["/purchase-orders"],
    queryFn: () => apiGet<PurchaseOrderOption[]>("/purchase-orders"),
    enabled: invOpen,
  });
  const poDetail = useQuery({
    queryKey: ["/purchase-orders", purchaseOrderId],
    queryFn: () => apiGet<PurchaseOrderDetail>(`/purchase-orders/${purchaseOrderId}`),
    enabled: !!purchaseOrderId,
  });

  const supplierInvoicesForPayment = (invoices.data ?? []).filter(
    (i) => i.supplier.id === supplierId && i.status === "ISSUED" && invoiceTotal(i) - invoiceAllocated(i) > 1e-9,
  );

  const createInvoice = useMutation({
    mutationFn: () =>
      apiPost("/ap/invoices", {
        purchaseOrderId,
        ...(invNotes ? { notes: invNotes } : {}),
        lines: Object.entries(lineQty)
          .filter(([, v]) => Number(v) > 0)
          .map(([purchaseOrderLineId, v]) => ({ purchaseOrderLineId, qty: Number(v) })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/ap/invoices"] });
      setInvOpen(false);
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Fatura kaydedilemedi", "error");
    },
  });

  const cancelInvoice = useMutation({
    mutationFn: (id: string) => apiPost(`/ap/invoices/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/ap/invoices"] }),
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Fatura iptal edilemedi", "error");
    },
  });

  const createPayment = useMutation({
    mutationFn: () =>
      apiPost("/ap/payments", {
        supplierId,
        ...(payNotes ? { notes: payNotes } : {}),
        allocations: Object.entries(allocAmount)
          .filter(([, v]) => Number(v) > 0)
          .map(([supplierInvoiceId, v]) => ({ supplierInvoiceId, amount: Number(v) })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/ap/payments"] });
      qc.invalidateQueries({ queryKey: ["/ap/invoices"] });
      qc.invalidateQueries({ queryKey: ["/ap/summary"] });
      setPayOpen(false);
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Ödeme kaydedilemedi", "error");
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-4 text-2xl font-bold">Borçlar (AP) — Tedarikçi Faturaları ve Ödemeler</h1>
        <h2 className="mb-2 text-lg font-semibold">Açık Bakiye (Tedarikçi Bazında)</h2>
        <Table headers={["Tedarikçi", "Para Birimi", "Açık Bakiye"]}>
          {(summary.data ?? []).length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                Açık bakiye yok
              </td>
            </tr>
          )}
          {(summary.data ?? []).map((s) => (
            <tr key={`${s.supplierId}:${s.currency}`}>
              <td className="px-4 py-3 font-medium">{s.supplierName}</td>
              <td className="px-4 py-3">{s.currency}</td>
              <td className="px-4 py-3">{fmtMoney(s.outstanding, s.currency)}</td>
            </tr>
          ))}
        </Table>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Tedarikçi Faturaları</h2>
          {canWrite && (
            <Button
              onClick={() => {
                setPurchaseOrderId("");
                setInvNotes("");
                setLineQty({});
                setInvOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Yeni Fatura
            </Button>
          )}
        </div>
        <Table headers={["No", "Tedarikçi", "Sipariş", "Tutar", "Bakiye", "Durum", "Tarih", ""]}>
          {(invoices.data ?? []).length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                Kayıt yok
              </td>
            </tr>
          )}
          {(invoices.data ?? []).map((inv) => {
            const total = invoiceTotal(inv);
            const balance = total - invoiceAllocated(inv);
            return (
              <tr key={inv.id}>
                <td className="px-4 py-3 font-medium">{inv.sinNo}</td>
                <td className="px-4 py-3">{inv.supplier.name}</td>
                <td className="px-4 py-3">{inv.purchaseOrder.poNo}</td>
                <td className="px-4 py-3">{total.toFixed(2)}</td>
                <td className="px-4 py-3">{balance.toFixed(2)}</td>
                <td className="px-4 py-3">{inv.status === "ISSUED" ? "Kesildi" : "İptal"}</td>
                <td className="px-4 py-3">{fmtDate(inv.issuedDate)}</td>
                <td className="px-4 py-3">
                  {canWrite && inv.status === "ISSUED" && (
                    <button className="text-red-600 hover:underline" onClick={() => cancelInvoice.mutate(inv.id)}>
                      İptal Et
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Tedarikçi Ödemeleri</h2>
          {canWrite && (
            <Button
              onClick={() => {
                setSupplierId("");
                setPayNotes("");
                setAllocAmount({});
                setPayOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Yeni Ödeme
            </Button>
          )}
        </div>
        <Table headers={["No", "Tedarikçi", "Tutar", "Tarih", "Tahsis Edilen Faturalar"]}>
          {(payments.data ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                Kayıt yok
              </td>
            </tr>
          )}
          {(payments.data ?? []).map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3 font-medium">{p.spNo}</td>
              <td className="px-4 py-3">{p.supplier.name}</td>
              <td className="px-4 py-3">{Number(p.amount).toFixed(2)}</td>
              <td className="px-4 py-3">{fmtDate(p.paymentDate)}</td>
              <td className="px-4 py-3 text-slate-500">
                {p.allocations.map((a) => `${a.supplierInvoice.sinNo}: ${Number(a.amount).toFixed(2)}`).join(", ")}
              </td>
            </tr>
          ))}
        </Table>
      </div>

      <Modal open={invOpen} title="Yeni Tedarikçi Faturası" onClose={() => setInvOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createInvoice.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="purchaseOrderId">Satınalma Siparişi</Label>
            <Select
              id="purchaseOrderId"
              required
              value={purchaseOrderId}
              onChange={(e) => {
                setPurchaseOrderId(e.target.value);
                setLineQty({});
              }}
            >
              <option value="">Seçin…</option>
              {purchaseOrders.data?.map((po) => (
                <option key={po.id} value={po.id}>
                  {po.poNo}
                </option>
              ))}
            </Select>
          </div>
          {poDetail.data && (
            <div className="space-y-2">
              <Label>Faturalanacak Miktarlar</Label>
              {poDetail.data.lines.map((l) => {
                const remaining = Number(l.receivedQty) - Number(l.invoicedQty);
                return (
                  <div key={l.id} className="grid grid-cols-[1fr_6rem] items-center gap-2">
                    <span className="text-sm">
                      {l.material.code} — kalan: {remaining}
                    </span>
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      max={remaining}
                      value={lineQty[l.id] ?? ""}
                      onChange={(e) => setLineQty((prev) => ({ ...prev, [l.id]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div>
            <Label htmlFor="invNotes">Notlar</Label>
            <Textarea id="invNotes" rows={2} value={invNotes} onChange={(e) => setInvNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setInvOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={createInvoice.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={payOpen} title="Yeni Tedarikçi Ödemesi" onClose={() => setPayOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createPayment.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="supplierId">Tedarikçi</Label>
            <Select
              id="supplierId"
              required
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setAllocAmount({});
              }}
            >
              <option value="">Seçin…</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          {supplierId && (
            <div className="space-y-2">
              <Label>Fatura Tahsisleri</Label>
              {supplierInvoicesForPayment.length === 0 && (
                <p className="text-sm text-slate-400">Bu tedarikçide açık fatura yok</p>
              )}
              {supplierInvoicesForPayment.map((inv) => {
                const balance = invoiceTotal(inv) - invoiceAllocated(inv);
                return (
                  <div key={inv.id} className="grid grid-cols-[1fr_6rem] items-center gap-2">
                    <span className="text-sm">
                      {inv.sinNo} — bakiye: {balance.toFixed(2)}
                    </span>
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      max={balance}
                      value={allocAmount[inv.id] ?? ""}
                      onChange={(e) => setAllocAmount((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div>
            <Label htmlFor="payNotes">Notlar</Label>
            <Textarea id="payNotes" rows={2} value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPayOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={createPayment.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
