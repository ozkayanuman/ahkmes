import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "../lib/api";
import { Card, Input, Label, Select, Table } from "../components/ui";

type Metric = { value: number | null };
type Cockpit = {
  context: { asOf: string; lastRefreshedAt?: string };
  summary: { metrics: { oee: Metric; availability: Metric; performance: Metric; quality: Metric; dataQuality: string; issues: { code: string }[] } };
  machines: { id: string; name: string; currentStatus: string | null; activeWorkOrder: { id: string; woNo: string } | null; oee: { value: number | null; dataQuality: string; facts: { goodCount: number; scrapCount: number } } | null; maintenanceOrderIds: string[] }[];
  blockers: { maintenance: { id: string; bakNo: string; status: string; priority: string }[]; qualityHolds: { id: string; reason: string }[]; materialExceptions: { id: string; type: string; severity: string }[] };
};

function pct(metric: Metric) { return metric.value === null ? "Veri yetersiz" : `%${(metric.value * 100).toFixed(0)}`; }
function dayContext(plantId: string, date: string) {
  const from = new Date(`${date}T00:00:00.000Z`);
  const to = new Date(`${date}T23:59:59.999Z`);
  return new URLSearchParams({ plantId, from: from.toISOString(), to: to.toISOString(), asOf: new Date().toISOString() });
}

export function OeeCockpitPage() {
  const [plantId, setPlantId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const plants = useQuery({ queryKey: ["/plants"], queryFn: () => apiGet<{ id: string; name: string }[]>("/plants") });
  const cockpit = useQuery({
    queryKey: ["/oee/cockpit", plantId, date],
    queryFn: () => apiGet<Cockpit>(`/oee/cockpit?${dayContext(plantId, date)}`),
    enabled: Boolean(plantId),
    refetchInterval: 30_000,
  });
  const data = cockpit.data;

  return <div>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-bold">OEE Cockpit</h1><p className="text-sm text-slate-500">Kanonik üretim, kalite, bakım ve malzeme görünümü</p></div>
      <div className="flex gap-2"><div className="w-48"><Label htmlFor="oee-cockpit-plant">Tesis</Label><Select id="oee-cockpit-plant" value={plantId} onChange={(event) => setPlantId(event.target.value)}><option value="">Tesis seçin</option>{(plants.data ?? []).map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}</Select></div><div><Label htmlFor="oee-cockpit-date">Tarih</Label><Input id="oee-cockpit-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div></div>
    </div>
    {!plantId && <p className="text-slate-500">Görünümü açmak için tesis seçin.</p>}
    {cockpit.isLoading && <p className="text-slate-500">Kanonik veriler yükleniyor…</p>}
    {cockpit.error && <p className="text-red-600">Cockpit verisi alınamadı.</p>}
    {data && <>
      <p className="mb-4 text-xs text-slate-500">Kesim zamanı: {new Date(data.context.asOf).toLocaleString("tr-TR")} · 30 sn’de bir yenilenir</p>
      <div className="mb-6 grid gap-3 md:grid-cols-4">
        {[['OEE', data.summary.metrics.oee], ['Kullanılabilirlik', data.summary.metrics.availability], ['Performans', data.summary.metrics.performance], ['Kalite', data.summary.metrics.quality]].map(([name, metric]) => <Card key={name as string}><div className="text-sm text-slate-500">{name as string}</div><div className="text-2xl font-bold">{pct(metric as Metric)}</div></Card>)}
      </div>
      <Card className="mb-6"><h2 className="mb-2 text-lg font-semibold">Veri kalitesi: {data.summary.metrics.dataQuality}</h2>{data.summary.metrics.issues.length > 0 && <p className="text-sm text-amber-700">{data.summary.metrics.issues.map((issue) => issue.code).join(", ")}</p>}</Card>
      <Card className="mb-6"><h2 className="mb-3 text-lg font-semibold">Makine durumu</h2><Table headers={["Makine", "Durum", "İş emri", "OEE", "Sağlam / Hurda", "Bakım"]}>{data.machines.map((machine) => <tr key={machine.id}><td>{machine.name}</td><td>{machine.currentStatus ?? "Bilinmiyor"}</td><td>{machine.activeWorkOrder?.woNo ?? "—"}</td><td>{machine.oee ? pct(machine.oee) : "Veri yetersiz"}</td><td>{machine.oee ? `${machine.oee.facts.goodCount} / ${machine.oee.facts.scrapCount}` : "—"}</td><td>{machine.maintenanceOrderIds.length}</td></tr>)}</Table></Card>
      <div className="grid gap-4 md:grid-cols-3"><BlockerCard title="Bakım blokajları" values={data.blockers.maintenance.map((item) => `${item.bakNo} · ${item.status}`)} /><BlockerCard title="Kalite blokajları" values={data.blockers.qualityHolds.map((item) => item.reason)} /><BlockerCard title="Malzeme istisnaları" values={data.blockers.materialExceptions.map((item) => `${item.type} · ${item.severity}`)} /></div>
    </>}
  </div>;
}

function BlockerCard({ title, values }: { title: string; values: string[] }) {
  return <Card><h2 className="mb-2 text-lg font-semibold">{title}</h2>{values.length === 0 ? <p className="text-sm text-slate-500">Aktif blokaj yok</p> : <ul className="list-inside list-disc text-sm">{values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul>}</Card>;
}
