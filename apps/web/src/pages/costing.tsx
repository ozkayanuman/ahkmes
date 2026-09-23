import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
import { Button, Card, Input, Label, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";

type Line = { id?: string; kind: "MATERIAL" | "MACHINE" | "LABOR"; targetId: string; rate: string };
type CardRow = { id: string; plantId: string; revision: number; currency: string; effectiveFrom: string; status: string; plant?: { name: string }; lines: Line[] };
type CostRow = { id: string; woNo: string; status: string; part: { partNo: string; name: string }; cost: { currency: string | null; dataQuality: string; planned: number | null; actual: number | null; variance: number | null; unitCost: number | null; issueCount: number } };
type Plant = { id: string; name: string };
type Machine = { id: string; name: string };
type Material = { id: string; code: string; name: string };

const money = (value: number | null | undefined, currency?: string | null) => value == null ? "Kullanılamıyor" : new Intl.NumberFormat("tr-TR", { style: "currency", currency: currency ?? "TRY" }).format(value);

export function CostingPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [plantId, setPlantId] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 16));
  const [currency, setCurrency] = useState("TRY");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([{ kind: "LABOR", targetId: "DEFAULT", rate: "" }]);
  const permissions = useQuery({ queryKey: ["/action-permissions/me"], queryFn: () => apiGet<string[]>("/action-permissions/me") });
  const plants = useQuery({ queryKey: ["/plants"], queryFn: () => apiGet<Plant[]>("/plants") });
  const materials = useQuery({ queryKey: ["/materials"], queryFn: () => apiGet<Material[]>("/materials") });
  const machines = useQuery({ queryKey: ["/machines"], queryFn: () => apiGet<Machine[]>("/machines") });
  const query = plantId ? `?plantId=${encodeURIComponent(plantId)}&asOf=${encodeURIComponent(new Date(asOf).toISOString())}` : "";
  const cards = useQuery({ queryKey: ["/costing/rate-cards", plantId], queryFn: () => apiGet<CardRow[]>(`/costing/rate-cards${plantId ? `?plantId=${encodeURIComponent(plantId)}` : ""}`) });
  const orders = useQuery({ queryKey: ["/costing/work-orders", plantId, asOf], queryFn: () => apiGet<CostRow[]>(`/costing/work-orders${query}`), enabled: Boolean(plantId) });
  const grants = useMemo(() => new Set(permissions.data ?? []), [permissions.data]);
  const canAdmin = grants.has("COSTING_RATE_ADMIN");
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["/costing/rate-cards"] }), qc.invalidateQueries({ queryKey: ["/costing/work-orders"] })]);
  const error = (fallback: string) => (reason: unknown) => toast(reason instanceof ApiError ? String((reason.body as { message?: string } | null)?.message ?? fallback) : fallback, "error");
  const create = useMutation({ mutationFn: () => apiPost("/costing/rate-cards", { plantId, currency, effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`).toISOString(), lines }), onSuccess: async () => { await refresh(); setLines([{ kind: "LABOR", targetId: "DEFAULT", rate: "" }]); toast("Taslak maliyet oran kartı oluşturuldu", "success"); }, onError: error("Oran kartı oluşturulamadı") });
  const release = useMutation({ mutationFn: (id: string) => apiPost(`/costing/rate-cards/${id}/release`, {}), onSuccess: async () => { await refresh(); toast("Oran kartı serbest bırakıldı", "success"); }, onError: error("Oran kartı serbest bırakılamadı") });
  const update = useMutation({ mutationFn: ({ id, lines: draftLines }: { id: string; lines: Line[] }) => apiPatch(`/costing/rate-cards/${id}`, { lines: draftLines }), onSuccess: refresh, onError: error("Oran kartı güncellenemedi") });
  const addLine = (kind: Line["kind"]) => setLines([...lines, { kind, targetId: kind === "LABOR" ? "DEFAULT" : "", rate: "" }]);
  const setLine = (index: number, patch: Partial<Line>) => setLines(lines.map((line, i) => i === index ? { ...line, ...patch } : line));

  return <div className="space-y-6">
    <header><h1 className="text-2xl font-bold">Üretim Maliyetlendirme</h1><p className="mt-1 text-sm text-slate-600">Serbest bırakılmış oran kartlarıyla sabitlenen planlanan/gerçekleşen standart maliyet farkı. Eksik veri sıfır kabul edilmez.</p></header>
    <Card className="p-4"><div className="grid gap-3 md:grid-cols-3"><div><Label htmlFor="costing-plant">Tesis</Label><Select id="costing-plant" value={plantId} onChange={(event) => setPlantId(event.target.value)}><option value="">Tesis seçin</option>{(plants.data ?? []).map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}</Select></div><div><Label htmlFor="costing-asof">Kesim zamanı</Label><Input id="costing-asof" type="datetime-local" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></div></div></Card>
    {canAdmin && plantId && <Card className="p-4"><h2 className="mb-3 text-lg font-semibold">Yeni oran kartı taslağı</h2><div className="mb-3 grid gap-3 md:grid-cols-2"><div><Label htmlFor="costing-currency">Para birimi</Label><Input id="costing-currency" maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></div><div><Label htmlFor="costing-effective">Geçerlilik başlangıcı</Label><Input id="costing-effective" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></div></div><div className="space-y-2">{lines.map((line, index) => <div key={index} className="grid gap-2 md:grid-cols-[10rem_1fr_10rem_auto]"><Select aria-label={`Oran türü ${index + 1}`} value={line.kind} onChange={(event) => setLine(index, { kind: event.target.value as Line["kind"], targetId: event.target.value === "LABOR" ? "DEFAULT" : "" })}><option value="MATERIAL">Malzeme</option><option value="MACHINE">Makine</option><option value="LABOR">İşçilik</option></Select>{line.kind === "LABOR" ? <Input disabled value="DEFAULT" /> : <Select aria-label={`Oran hedefi ${index + 1}`} value={line.targetId} onChange={(event) => setLine(index, { targetId: event.target.value })}><option value="">Hedef seçin</option>{(line.kind === "MATERIAL" ? materials.data ?? [] : machines.data ?? []).map((target) => <option key={target.id} value={target.id}>{"code" in target ? `${target.code} · ${target.name}` : target.name}</option>)}</Select>}<Input aria-label={`Oran ${index + 1}`} type="number" min="0" step="0.000001" placeholder="Saat/birim oranı" value={line.rate} onChange={(event) => setLine(index, { rate: event.target.value })} /><Button type="button" variant="ghost" onClick={() => setLines(lines.filter((_, i) => i !== index))}>Kaldır</Button></div>)}</div><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => addLine("MATERIAL")}>Malzeme satırı</Button><Button type="button" variant="outline" onClick={() => addLine("MACHINE")}>Makine satırı</Button><Button disabled={!lines.length || create.isPending} onClick={() => create.mutate()}>Taslak oluştur</Button></div></Card>}
    <section><h2 className="mb-3 text-lg font-semibold">Oran kartları</h2><Table headers={["Tesis", "Revizyon", "Geçerlilik", "Para birimi", "Durum", "Satırlar", ""]}>{(cards.data ?? []).map((card) => <tr key={card.id}><td>{card.plant?.name ?? card.plantId}</td><td>R{card.revision}</td><td>{new Date(card.effectiveFrom).toLocaleDateString("tr-TR")}</td><td>{card.currency}</td><td>{card.status}</td><td>{card.lines.length}</td><td>{canAdmin && card.status === "DRAFT" && <Button size="sm" onClick={() => release.mutate(card.id)}>Serbest bırak</Button>}</td></tr>)}</Table>{cards.data?.length === 0 && <p className="mt-2 text-sm text-slate-500">Bu tesis için oran kartı yok.</p>}</section>
    <section><h2 className="mb-3 text-lg font-semibold">İş emri maliyet özeti</h2>{!plantId ? <p className="text-sm text-slate-500">Maliyet görünümü için tesis seçin.</p> : <Table headers={["İş emri", "Parça", "Kalite", "Planlanan", "Gerçekleşen", "Fark", "İyi birim maliyeti", "Sorun"]}>{(orders.data ?? []).map((order) => <tr key={order.id}><td>{order.woNo}<div className="text-xs text-slate-500">{order.status}</div></td><td>{order.part.partNo} · {order.part.name}</td><td>{order.cost.dataQuality}</td><td>{money(order.cost.planned, order.cost.currency)}</td><td>{money(order.cost.actual, order.cost.currency)}</td><td>{money(order.cost.variance, order.cost.currency)}</td><td>{money(order.cost.unitCost, order.cost.currency)}</td><td>{order.cost.issueCount || "—"}</td></tr>)}</Table>}</section>
    {update.isPending && <span className="sr-only">Güncelleniyor</span>}
  </div>;
}
