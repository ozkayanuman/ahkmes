import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtMoney } from "../lib/format";
import { Button, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

interface CustomerOption {
  id: string;
  name: string;
}
interface InvoiceRow {
  id: string;
  invNo: string;
  status: "ISSUED" | "CANCELLED";
  salesOrder: { id: string; soNo: string; customerId: string; customer: { id: string; name: string } };
  lines: { qty: string; unitPrice: string }[];
  allocations: { amount: string }[];
}
interface CustomerPaymentRow {
  id: string;
  cpNo: string;
  amount: string;
  paymentDate: string;
  customer: { id: string; name: string };
  allocations: { amount: string; invoice: { id: string; invNo: string } }[];
  isReconciled: boolean;
  bankReference: string | null;
  reconciledBy?: { id: string; name: string } | null;
}
interface SummaryRow {
  customerId: string;
  customerName: string;
  currency: string;
  outstanding: number;
}

function invoiceTotal(inv: InvoiceRow) {
  return inv.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
}
function invoiceAllocated(inv: InvoiceRow) {
  return inv.allocations.reduce((s, a) => s + Number(a.amount), 0);
}

export function ArPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "SALES"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();

  const [payOpen, setPayOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");
  const [allocAmount, setAllocAmount] = useState<Record<string, string>>({});

  const invoices = useQuery({
    queryKey: ["/invoices"],
    queryFn: () => apiGet<InvoiceRow[]>("/invoices"),
  });
  const payments = useQuery({
    queryKey: ["/ar/payments"],
    queryFn: () => apiGet<CustomerPaymentRow[]>("/ar/payments"),
  });
  const summary = useQuery({
    queryKey: ["/ar/summary"],
    queryFn: () => apiGet<SummaryRow[]>("/ar/summary"),
  });
  const customers = useQuery({
    queryKey: ["/customers"],
    queryFn: () => apiGet<CustomerOption[]>("/customers"),
    enabled: payOpen,
  });

  const openInvoicesForPayment = (invoices.data ?? []).filter(
    (i) =>
      i.salesOrder.customerId === customerId && i.status === "ISSUED" && invoiceTotal(i) - invoiceAllocated(i) > 1e-9,
  );

  const [reconcileFor, setReconcileFor] = useState<CustomerPaymentRow | null>(null);
  const [bankReference, setBankReference] = useState("");
  const reconcile = useMutation({
    mutationFn: () => apiPost(`/ar/payments/${reconcileFor!.id}/reconcile`, { bankReference }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/ar/payments"] }); setReconcileFor(null); toast("Ödeme mutabık işaretlendi.", "success"); },
    onError: () => toast("Mutabakat kaydedilemedi.", "error"),
  });
  const unreconcile = useMutation({
    mutationFn: (id: string) => apiPost(`/ar/payments/${id}/unreconcile`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/ar/payments"] }); toast("Mutabakat geri alındı.", "success"); },
    onError: () => toast("İşlem başarısız.", "error"),
  });

  const createPayment = useMutation({
    mutationFn: () =>
      apiPost("/ar/payments", {
        customerId,
        ...(notes ? { notes } : {}),
        allocations: Object.entries(allocAmount)
          .filter(([, v]) => Number(v) > 0)
          .map(([invoiceId, v]) => ({ invoiceId, amount: Number(v) })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/ar/payments"] });
      qc.invalidateQueries({ queryKey: ["/invoices"] });
      qc.invalidateQueries({ queryKey: ["/ar/summary"] });
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
        <h1 className="mb-4 text-2xl font-bold">Alacaklar (AR) — Müşteri Tahsilatları</h1>
        <h2 className="mb-2 text-lg font-semibold">Açık Bakiye (Müşteri Bazında)</h2>
        <Table headers={["Müşteri", "Para Birimi", "Açık Bakiye"]}>
          {(summary.data ?? []).length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                Açık bakiye yok
              </td>
            </tr>
          )}
          {(summary.data ?? []).map((s) => (
            <tr key={`${s.customerId}:${s.currency}`}>
              <td className="px-4 py-3 font-medium">{s.customerName}</td>
              <td className="px-4 py-3">{s.currency}</td>
              <td className="px-4 py-3">{fmtMoney(s.outstanding, s.currency)}</td>
            </tr>
          ))}
        </Table>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Müşteri Tahsilatları</h2>
          {canWrite && (
            <Button
              onClick={() => {
                setCustomerId("");
                setNotes("");
                setAllocAmount({});
                setPayOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Yeni Tahsilat
            </Button>
          )}
        </div>
        <Table headers={["No", "Müşteri", "Tutar", "Tarih", "Tahsis Edilen Faturalar", "Banka Mutabakatı"]}>
          {(payments.data ?? []).length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                Kayıt yok
              </td>
            </tr>
          )}
          {(payments.data ?? []).map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3 font-medium">{p.cpNo}</td>
              <td className="px-4 py-3">{p.customer.name}</td>
              <td className="px-4 py-3">{Number(p.amount).toFixed(2)}</td>
              <td className="px-4 py-3">{fmtDate(p.paymentDate)}</td>
              <td className="px-4 py-3 text-slate-500">
                {p.allocations.map((a) => `${a.invoice.invNo}: ${Number(a.amount).toFixed(2)}`).join(", ")}
              </td>
              <td className="px-4 py-3">
                {p.isReconciled ? (
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800" title={p.bankReference ?? undefined}>
                      Mutabık{p.reconciledBy ? ` · ${p.reconciledBy.name}` : ""}
                    </span>
                    {canWrite && <Button size="sm" variant="outline" disabled={unreconcile.isPending} onClick={() => unreconcile.mutate(p.id)}>Geri Al</Button>}
                  </div>
                ) : (
                  canWrite ? (
                    <Button size="sm" variant="outline" onClick={() => { setReconcileFor(p); setBankReference(""); }}>Mutabık Kıl</Button>
                  ) : (
                    <span className="text-xs text-slate-400">Mutabık değil</span>
                  )
                )}
              </td>
            </tr>
          ))}
        </Table>
      </div>

      <Modal open={payOpen} title="Yeni Müşteri Tahsilatı" onClose={() => setPayOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createPayment.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="customerId">Müşteri</Label>
            <Select
              id="customerId"
              required
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setAllocAmount({});
              }}
            >
              <option value="">Seçin…</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          {customerId && (
            <div className="space-y-2">
              <Label>Fatura Tahsisleri</Label>
              {openInvoicesForPayment.length === 0 && (
                <p className="text-sm text-slate-400">Bu müşteride açık fatura yok</p>
              )}
              {openInvoicesForPayment.map((inv) => {
                const balance = invoiceTotal(inv) - invoiceAllocated(inv);
                return (
                  <div key={inv.id} className="grid grid-cols-[1fr_6rem] items-center gap-2">
                    <span className="text-sm">
                      {inv.invNo} — bakiye: {balance.toFixed(2)}
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
            <Label htmlFor="notes">Notlar</Label>
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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

      <Modal open={!!reconcileFor} title={`${reconcileFor?.cpNo} — Banka Mutabakatı`} onClose={() => setReconcileFor(null)}>
        <form onSubmit={(e) => { e.preventDefault(); reconcile.mutate(); }} className="space-y-4">
          <div>
            <Label htmlFor="bankRef">Banka Ekstresi Referansı</Label>
            <Input id="bankRef" required value={bankReference} onChange={(e) => setBankReference(e.target.value)} placeholder="Örn. ekstre tarih/satır no" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setReconcileFor(null)}>Vazgeç</Button>
            <Button type="submit" disabled={reconcile.isPending}>Mutabık Kıl</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
