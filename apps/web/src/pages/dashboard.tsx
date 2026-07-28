import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet } from "../lib/api";
import { fmtDate, fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { QUOTE_STATUS, StatusBadge, WO_STATUS } from "../components/status";
import { Card, Table } from "../components/ui";

interface DashboardData {
  workOrderCounts: Record<string, number>;
  activeWorkOrders: {
    id: string;
    woNo: string;
    quantity: string;
    dueDate: string;
    priority: number;
    status: string;
    part: { partNo: string; name: string };
    machine?: { name: string } | null;
  }[];
  pendingQuotes: {
    id: string;
    quoteNo: string;
    status: string;
    createdAt: string;
    customer: { name: string };
  }[];
  criticalStock: {
    id: string;
    code: string;
    name: string;
    unit: string;
    stockQty: string;
    minStock: string;
  }[];
  recentRuns: {
    id: string;
    startedAt: string;
    endedAt?: string | null;
    goodCount: number;
    scrapCount: number;
    workOrder: { id: string; woNo: string; part: { partNo: string; name: string } };
    operator: { name: string };
  }[];
  openNonConformanceCount: number;
}

const COUNT_ORDER = ["PLANNED", "WAITING_MATERIAL", "IN_PRODUCTION", "COMPLETED", "CANCELLED"];

export function DashboardPage() {
  useInvalidateOn(
    [
      "workorder.updated",
      "quote.updated",
      "stock.updated",
      "productionrun.updated",
      "purchaseorder.updated",
      "nonconformance.updated",
    ],
    ["/dashboard"],
  );
  const query = useQuery({
    queryKey: ["/dashboard"],
    queryFn: () => apiGet<DashboardData>("/dashboard"),
  });

  if (query.isLoading) return <p className="text-slate-500">Yükleniyor…</p>;
  if (query.error || !query.data) return <p className="text-red-600">Panel verisi alınamadı.</p>;
  const d = query.data;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Panel</h1>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {COUNT_ORDER.map((s) => (
          <Card key={s}>
            <div className="text-xs uppercase text-slate-500">{WO_STATUS[s]?.label ?? s}</div>
            <div className="mt-1 text-3xl font-bold">{d.workOrderCounts[s] ?? 0}</div>
          </Card>
        ))}
        <Link to="/non-conformances">
          <Card>
            <div className="text-xs uppercase text-slate-500">Açık Uygunsuzluk</div>
            <div className="mt-1 text-3xl font-bold text-red-600">{d.openNonConformanceCount}</div>
          </Card>
        </Link>
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Aktif İş Emirleri</h2>
          <Table headers={["İş Emri", "Parça", "Öncelik", "Termin", "Durum", "Tezgah"]}>
            {d.activeWorkOrders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Aktif iş emri yok
                </td>
              </tr>
            )}
            {d.activeWorkOrders.map((wo) => (
              <tr key={wo.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/work-orders/${wo.id}`} className="font-medium text-brand-700 hover:underline">
                    {wo.woNo}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {wo.part.partNo} — {wo.part.name}
                </td>
                <td className="px-4 py-3">{wo.priority}</td>
                <td className="px-4 py-3">{fmtDate(wo.dueDate)}</td>
                <td className="px-4 py-3">
                  <StatusBadge map={WO_STATUS} status={wo.status} />
                </td>
                <td className="px-4 py-3">{wo.machine?.name ?? "—"}</td>
              </tr>
            ))}
          </Table>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Bekleyen Teklifler</h2>
          <Table headers={["Teklif", "Müşteri", "Durum", "Tarih"]}>
            {d.pendingQuotes.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Bekleyen teklif yok
                </td>
              </tr>
            )}
            {d.pendingQuotes.map((q) => (
              <tr key={q.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/quotes/${q.id}`} className="font-medium text-brand-700 hover:underline">
                    {q.quoteNo}
                  </Link>
                </td>
                <td className="px-4 py-3">{q.customer.name}</td>
                <td className="px-4 py-3">
                  <StatusBadge map={QUOTE_STATUS} status={q.status} />
                </td>
                <td className="px-4 py-3">{fmtDate(q.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Kritik Stok (Min. Altı)</h2>
          <Table headers={["Kod", "Ad", "Stok", "Min. Stok"]}>
            {d.criticalStock.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Kritik stok yok
                </td>
              </tr>
            )}
            {d.criticalStock.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{m.code}</td>
                <td className="px-4 py-3">{m.name}</td>
                <td className="px-4 py-3 font-semibold text-red-600">
                  {fmtQty(m.stockQty)} {m.unit}
                </td>
                <td className="px-4 py-3">
                  {fmtQty(m.minStock)} {m.unit}
                </td>
              </tr>
            ))}
          </Table>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Son Üretim Koşuları</h2>
          <Table headers={["İş Emri", "Parça", "Operatör", "Sağlam/Hurda", "Başlangıç"]}>
            {d.recentRuns.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Üretim kaydı yok
                </td>
              </tr>
            )}
            {d.recentRuns.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    to={`/work-orders/${r.workOrder.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {r.workOrder.woNo}
                  </Link>
                  {!r.endedAt && (
                    <span className="ml-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                      aktif
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.workOrder.part.partNo} — {r.workOrder.part.name}
                </td>
                <td className="px-4 py-3">{r.operator.name}</td>
                <td className="px-4 py-3">
                  {r.goodCount} / <span className="text-red-600">{r.scrapCount}</span>
                </td>
                <td className="px-4 py-3">{new Date(r.startedAt).toLocaleString("tr-TR")}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </div>
  );
}
