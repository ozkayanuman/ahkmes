import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Factory, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { SALES_ORDER_STATUS, StatusBadge } from "../components/status";
import { Button, Input, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";

interface SalesOrderRow {
  id: string;
  soNo: string;
  status: string;
  currency: string;
  createdAt: string;
  customer: { id: string; name: string };
  quote: { id: string; quoteNo: string } | null;
  lines: { id: string; workOrders: { id: string; woNo: string }[] }[];
}

export function SalesOrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = !!user && ["ADMIN", "SALES", "PLANNER"].includes(user.role);
  const canRelease = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  useInvalidateOn(["salesorder.updated", "workorder.updated"], ["/sales-orders"]);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const query = useQuery({
    queryKey: ["/sales-orders", q, status],
    queryFn: () => apiGet<SalesOrderRow[]>(`/sales-orders?${params.toString()}`),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/sales-orders"] });

  const release = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ workOrders: { id: string; woNo: string }[] }>(`/sales-orders/${id}/release`, {}),
    onSuccess: (res) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["/work-orders"] });
      toast(
        res.workOrders.length > 0
          ? `${res.workOrders.length} iş emri oluşturuldu: ${res.workOrders.map((w) => w.woNo).join(", ")}`
          : "Üretime alınacak yeni satır yok",
        res.workOrders.length > 0 ? "success" : "info",
      );
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Üretime alınamadı", "error");
    },
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      apiPatch(`/sales-orders/${id}/status`, { status: next }),
    onSuccess: invalidate,
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Durum güncellenemedi", "error");
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Satış Siparişleri</h1>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Sipariş no veya müşteri ara…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-48">
          <option value="">Tüm Durumlar</option>
          {Object.entries(SALES_ORDER_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {query.error && <p className="text-red-600">Liste alınamadı.</p>}

      {query.data && (
        <Table headers={["Sipariş No", "Müşteri", "Kaynak Teklif", "Durum", "Satır", "Tarih", "İşlem"]}>
          {query.data.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                Kayıt yok
              </td>
            </tr>
          )}
          {query.data.map((row) => {
            const allReleased = row.lines.every((l) => l.workOrders.length > 0);
            return (
              <tr
                key={row.id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => navigate(`/sales-orders/${row.id}`)}
              >
                <td className="px-4 py-3 font-medium">{row.soNo}</td>
                <td className="px-4 py-3">{row.customer.name}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  {row.quote ? (
                    <Link to={`/quotes/${row.quote.id}`} className="text-brand-700 hover:underline">
                      {row.quote.quoteNo}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge map={SALES_ORDER_STATUS} status={row.status} />
                </td>
                <td className="px-4 py-3">{row.lines.length}</td>
                <td className="px-4 py-3">{fmtDate(row.createdAt)}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap gap-1">
                    {canRelease && row.status === "OPEN" && !allReleased && (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        disabled={release.isPending}
                        onClick={() => release.mutate(row.id)}
                      >
                        <Factory className="h-4 w-4" /> Üretime Al
                      </Button>
                    )}
                    {canManage && row.status === "OPEN" && (
                      <>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          onClick={() => changeStatus.mutate({ id: row.id, next: "CLOSED" })}
                        >
                          Kapat
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs text-red-600"
                          onClick={() => changeStatus.mutate({ id: row.id, next: "CANCELLED" })}
                        >
                          İptal
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
