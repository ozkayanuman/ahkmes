import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardX,
  FileText,
  Gauge,
  PackageX,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { apiGet } from "../lib/api";
import { fmtDate, fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { QUOTE_STATUS, StatusBadge, WO_STATUS } from "../components/status";
import { Card, Label, Select, Table } from "../components/ui";
import { DowntimeParetoChart, OeeTrendChart } from "../components/oee-charts";

interface OeeTrendPoint {
  date: string;
  goodCount: number;
  scrapCount: number;
  quality: number | null;
  performance: number | null;
  availability: number | null;
  oee: number | null;
  downtimeSeconds: number;
}

interface DowntimeReason {
  reason: string;
  totalSeconds: number;
  count: number;
}

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
  plants: { id: string; name: string }[];
}

const KPI_CONFIG = [
  { key: "PLANNED", icon: CalendarClock, iconCls: "bg-slate-100 text-slate-600" },
  { key: "WAITING_MATERIAL", icon: PackageX, iconCls: "bg-amber-100 text-amber-600" },
  { key: "IN_PRODUCTION", icon: Gauge, iconCls: "bg-blue-100 text-blue-600" },
  { key: "COMPLETED", icon: CheckCircle2, iconCls: "bg-green-100 text-green-600" },
  { key: "CANCELLED", icon: XCircle, iconCls: "bg-red-100 text-red-600" },
] as const;

function KpiCard({
  icon: Icon,
  iconCls,
  label,
  value,
  to,
}: {
  icon: typeof Gauge;
  iconCls: string;
  label: string;
  value: number;
  to?: string;
}) {
  const content = (
    <Card className="flex items-center gap-3 transition-shadow hover:shadow-md">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${iconCls}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase leading-tight tracking-wide text-slate-500">{label}</div>
        <div className="text-2xl font-bold text-slate-800">{value}</div>
      </div>
    </Card>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

function PanelHeader({ icon: Icon, title, to }: { icon: typeof Gauge; title: string; to: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
        <Icon className="h-5 w-5 text-slate-400" />
        {title}
      </h2>
      <Link to={to} className="flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
        Tümünü Gör <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function EmptyRow({ colSpan, icon: Icon, text }: { colSpan: number; icon: typeof Gauge; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center">
        <Icon className="mx-auto mb-2 h-6 w-6 text-slate-300" />
        <span className="text-sm text-slate-400">{text}</span>
      </td>
    </tr>
  );
}

export function DashboardPage() {
  const [plantId, setPlantId] = useState("");
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
  const oeeContext = useMemo(() => {
    if (!plantId) return null;
    const asOf = new Date();
    const from = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate() - 13));
    return new URLSearchParams({ plantId, from: from.toISOString(), to: asOf.toISOString(), asOf: asOf.toISOString() }).toString();
  }, [plantId]);
  const oeeTrend = useQuery({
    queryKey: ["/oee/trend", oeeContext],
    queryFn: () => apiGet<OeeTrendPoint[]>(`/oee/trend?${oeeContext}`),
    enabled: oeeContext !== null,
  });
  const downtimePareto = useQuery({
    queryKey: ["/oee/downtime-pareto", oeeContext],
    queryFn: () => apiGet<DowntimeReason[]>(`/oee/downtime-pareto?${oeeContext}`),
    enabled: oeeContext !== null,
  });

  if (query.isLoading) return <p className="text-slate-500">Yükleniyor…</p>;
  if (query.error || !query.data) return <p className="text-red-600">Panel verisi alınamadı.</p>;
  const d = query.data;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Panel</h1>
        <div className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Canlı
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {KPI_CONFIG.map(({ key, icon, iconCls }) => (
          <KpiCard key={key} icon={icon} iconCls={iconCls} label={WO_STATUS[key]?.label ?? key} value={d.workOrderCounts[key] ?? 0} />
        ))}
        <Link to="/non-conformances">
          <Card
            className={`flex items-center gap-3 transition-shadow hover:shadow-md ${
              d.openNonConformanceCount > 0 ? "border-red-200 bg-red-50" : ""
            }`}
          >
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
                d.openNonConformanceCount > 0 ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500"
              }`}
            >
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase leading-tight tracking-wide text-slate-500">
                Açık Uygunsuzluk
              </div>
              <div className={`text-2xl font-bold ${d.openNonConformanceCount > 0 ? "text-red-600" : "text-slate-800"}`}>
                {d.openNonConformanceCount}
              </div>
            </div>
          </Card>
        </Link>
      </div>

      <Card className="mb-6 flex flex-wrap items-end gap-3 py-4">
        <div className="w-full max-w-sm">
          <Label htmlFor="oee-plant">OEE tesisi</Label>
          <Select id="oee-plant" value={plantId} onChange={(event) => setPlantId(event.target.value)}>
            <option value="">Tesis seçin</option>
            {d.plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
          </Select>
        </div>
        <p className="pb-2 text-sm text-slate-500">Trend ve Pareto, seçilen tesisin son 14 günlük açık hesap bağlamıyla gösterilir.</p>
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <PanelHeader icon={Gauge} title="OEE Trend (Son 14 Gün)" to="/work-orders" />
          {!oeeContext ? (
            <p className="py-8 text-center text-sm text-slate-400">OEE için tesis seçin.</p>
          ) : oeeTrend.isLoading ? (
            <p className="py-8 text-center text-sm text-slate-400">Yükleniyor…</p>
          ) : (
            <OeeTrendChart data={oeeTrend.data ?? []} />
          )}
        </Card>
        <Card>
          <PanelHeader icon={ShieldAlert} title="Duruş Nedenleri (Pareto)" to="/machines" />
          {!oeeContext ? (
            <p className="py-8 text-center text-sm text-slate-400">OEE için tesis seçin.</p>
          ) : downtimePareto.isLoading ? (
            <p className="py-8 text-center text-sm text-slate-400">Yükleniyor…</p>
          ) : (
            <DowntimeParetoChart data={downtimePareto.data ?? []} />
          )}
        </Card>
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <div>
          <PanelHeader icon={ClipboardX} title="Aktif İş Emirleri" to="/work-orders" />
          <Table headers={["İş Emri", "Parça", "Öncelik", "Termin", "Durum", "Tezgah"]}>
            {d.activeWorkOrders.length === 0 && (
              <EmptyRow colSpan={6} icon={ClipboardX} text="Aktif iş emri yok" />
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
          <PanelHeader icon={FileText} title="Bekleyen Teklifler" to="/quotes" />
          <Table headers={["Teklif", "Müşteri", "Durum", "Tarih"]}>
            {d.pendingQuotes.length === 0 && <EmptyRow colSpan={4} icon={FileText} text="Bekleyen teklif yok" />}
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
          <PanelHeader icon={Boxes} title="Kritik Stok (Min. Altı)" to="/materials" />
          <Table headers={["Kod", "Ad", "Stok", "Min. Stok"]}>
            {d.criticalStock.length === 0 && <EmptyRow colSpan={4} icon={Boxes} text="Kritik stok yok" />}
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
          <PanelHeader icon={Gauge} title="Son Üretim Koşuları" to="/production" />
          <Table headers={["İş Emri", "Parça", "Operatör", "Sağlam/Hurda", "Başlangıç"]}>
            {d.recentRuns.length === 0 && <EmptyRow colSpan={5} icon={Gauge} text="Üretim kaydı yok" />}
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
