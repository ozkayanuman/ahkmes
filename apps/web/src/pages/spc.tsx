import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Input, Label, Modal, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";

interface PartOption {
  id: string;
  partNo: string;
  name: string;
}
interface WorkOrderOption {
  id: string;
  woNo: string;
}
interface CharacteristicRow {
  id: string;
  name: string;
  unit: string | null;
  target: string | null;
  uslUpper: string | null;
  lslLower: string | null;
  part: { id: string; partNo: string; name: string };
}
interface MeasurementRow {
  id: string;
  value: string;
  inSpec: boolean | null;
  measuredAt: string;
  measuredBy: { id: string; name: string };
  workOrder: { id: string; woNo: string } | null;
}
interface StatsResult {
  sampleSize: number;
  mean: number | null;
  stddev: number | null;
  cp: number | null;
  cpk: number | null;
  note?: string;
}

export function SpcPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const canMeasure = !!user && ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [charOpen, setCharOpen] = useState(false);
  const [selected, setSelected] = useState<CharacteristicRow | null>(null);
  const [measureOpen, setMeasureOpen] = useState(false);

  const [partId, setPartId] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [target, setTarget] = useState("");
  const [uslUpper, setUslUpper] = useState("");
  const [lslLower, setLslLower] = useState("");

  const [value, setValue] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");

  const characteristics = useQuery({
    queryKey: ["/spc/characteristics"],
    queryFn: () => apiGet<CharacteristicRow[]>("/spc/characteristics"),
  });
  const parts = useQuery({
    queryKey: ["/parts"],
    queryFn: () => apiGet<PartOption[]>("/parts"),
    enabled: charOpen,
  });
  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WorkOrderOption[]>("/work-orders"),
    enabled: measureOpen,
  });
  const measurements = useQuery({
    queryKey: ["/spc/measurements", selected?.id],
    queryFn: () => apiGet<MeasurementRow[]>(`/spc/measurements?characteristicId=${selected!.id}`),
    enabled: !!selected,
  });
  const stats = useQuery({
    queryKey: ["/spc/characteristics", selected?.id, "stats"],
    queryFn: () => apiGet<StatsResult>(`/spc/characteristics/${selected!.id}/stats`),
    enabled: !!selected,
  });

  const createChar = useMutation({
    mutationFn: () =>
      apiPost("/spc/characteristics", {
        partId,
        name,
        ...(unit ? { unit } : {}),
        ...(target ? { target: Number(target) } : {}),
        ...(uslUpper ? { uslUpper: Number(uslUpper) } : {}),
        ...(lslLower ? { lslLower: Number(lslLower) } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/spc/characteristics"] });
      setCharOpen(false);
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Karakteristik kaydedilemedi", "error");
    },
  });

  const recordMeasurement = useMutation({
    mutationFn: () =>
      apiPost("/spc/measurements", {
        characteristicId: selected!.id,
        value: Number(value),
        ...(workOrderId ? { workOrderId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/spc/measurements", selected?.id] });
      qc.invalidateQueries({ queryKey: ["/spc/characteristics", selected?.id, "stats"] });
      qc.invalidateQueries({ queryKey: ["/non-conformances"] });
      setMeasureOpen(false);
      setValue("");
      setWorkOrderId("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Ölçüm kaydedilemedi", "error");
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">SPC — İstatistiksel Süreç Kontrolü</h1>
        {canWrite && (
          <Button onClick={() => { setPartId(""); setName(""); setUnit(""); setTarget(""); setUslUpper(""); setLslLower(""); setCharOpen(true); }}>
            <Plus className="h-4 w-4" /> Yeni Karakteristik
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <Table headers={["Parça", "Karakteristik", "LSL", "USL", ""]}>
            {(characteristics.data ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Kayıt yok
                </td>
              </tr>
            )}
            {(characteristics.data ?? []).map((c) => (
              <tr key={c.id} className={selected?.id === c.id ? "bg-brand-50" : ""}>
                <td className="px-4 py-3">{c.part.partNo}</td>
                <td className="px-4 py-3 font-medium">
                  {c.name} {c.unit ? `(${c.unit})` : ""}
                </td>
                <td className="px-4 py-3">{c.lslLower ?? "—"}</td>
                <td className="px-4 py-3">{c.uslUpper ?? "—"}</td>
                <td className="px-4 py-3">
                  <button className="text-brand-700 hover:underline" onClick={() => setSelected(c)}>
                    Detay
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </div>

        {selected && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{selected.name} — Ölçümler</h2>
              {canMeasure && (
                <Button
                  onClick={() => {
                    setValue("");
                    setWorkOrderId("");
                    setMeasureOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" /> Ölçüm Ekle
                </Button>
              )}
            </div>

            {stats.data && (
              <div className="mb-4 grid grid-cols-4 gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <div>
                  <div className="text-slate-500">Örneklem</div>
                  <div className="font-semibold">{stats.data.sampleSize}</div>
                </div>
                <div>
                  <div className="text-slate-500">Ortalama</div>
                  <div className="font-semibold">{stats.data.mean?.toFixed(3) ?? "—"}</div>
                </div>
                <div>
                  <div className="text-slate-500">Cp</div>
                  <div className="font-semibold">{stats.data.cp?.toFixed(2) ?? "—"}</div>
                </div>
                <div>
                  <div className="text-slate-500">Cpk</div>
                  <div className="font-semibold">{stats.data.cpk?.toFixed(2) ?? "—"}</div>
                </div>
                {stats.data.note && <div className="col-span-4 text-xs text-amber-600">{stats.data.note}</div>}
              </div>
            )}

            <Table headers={["Değer", "Durum", "İş Emri", "Ölçen", "Tarih"]}>
              {(measurements.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Ölçüm yok
                  </td>
                </tr>
              )}
              {(measurements.data ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 font-medium">{m.value}</td>
                  <td className="px-4 py-3">
                    {m.inSpec === null ? (
                      "—"
                    ) : m.inSpec ? (
                      <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        Limit İçi
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                        Limit Dışı
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{m.workOrder?.woNo ?? "—"}</td>
                  <td className="px-4 py-3">{m.measuredBy.name}</td>
                  <td className="px-4 py-3">{fmtDate(m.measuredAt)}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </div>

      <Modal open={charOpen} title="Yeni SPC Karakteristiği" onClose={() => setCharOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createChar.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="partId">Parça</Label>
            <Select id="partId" required value={partId} onChange={(e) => setPartId(e.target.value)}>
              <option value="">Seçin…</option>
              {parts.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partNo} — {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="name">Karakteristik Adı</Label>
            <Input id="name" required placeholder="Örn: Çap" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="unit">Birim</Label>
              <Input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="target">Hedef</Label>
              <Input id="target" type="number" step="any" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="lslLower">LSL (Alt Limit)</Label>
              <Input id="lslLower" type="number" step="any" value={lslLower} onChange={(e) => setLslLower(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="uslUpper">USL (Üst Limit)</Label>
              <Input id="uslUpper" type="number" step="any" value={uslUpper} onChange={(e) => setUslUpper(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCharOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={createChar.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={measureOpen} title="Yeni Ölçüm" onClose={() => setMeasureOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            recordMeasurement.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="value">Ölçüm Değeri</Label>
            <Input id="value" type="number" step="any" required value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="workOrderId">İş Emri (opsiyonel)</Label>
            <Select id="workOrderId" value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
              <option value="">—</option>
              {workOrders.data?.map((wo) => (
                <option key={wo.id} value={wo.id}>
                  {wo.woNo}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-sm text-amber-600">
            Limit dışı bir değer, iş emri seçilmişse otomatik bir uygunsuzluk (NonConformance) kaydı açar.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setMeasureOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={recordMeasurement.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
