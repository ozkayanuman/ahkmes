import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Zap } from "lucide-react";
import { useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import { Button, Card, Input, Label, Modal, Select } from "../components/ui";
import { useToast } from "../components/toast";

interface MachineOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface MachineEnergy {
  machineId: string;
  machineName: string;
  kwh: number;
  goodCount: number;
  kwhPerPart: number | null;
}

interface EnergySummary {
  from: string;
  to: string;
  machines: MachineEnergy[];
  totalKwh: number;
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function AddReadingModal({ machines, onClose }: { machines: MachineOption[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [kwh, setKwh] = useState("");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: () => apiPost("/energy", { machineId, kwh, notes: notes || undefined }),
    onSuccess: () => {
      toast("Enerji kaydı eklendi", "success");
      qc.invalidateQueries({ queryKey: ["/energy/summary"] });
      onClose();
    },
    onError: () => toast("Kayıt eklenemedi", "error"),
  });

  return (
    <Modal open title="Enerji Kaydı Ekle" onClose={onClose} className="max-w-md">
      <div className="space-y-4 text-sm">
        <div>
          <Label htmlFor="machine">Tezgah</Label>
          <Select id="machine" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="kwh">Tüketim (kWh)</Label>
          <Input id="kwh" type="number" step="0.01" value={kwh} onChange={(e) => setKwh(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="notes">Not (opsiyonel)</Label>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            İptal
          </Button>
          <Button disabled={!machineId || !kwh || create.isPending} onClick={() => create.mutate()}>
            Kaydet
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Faz I Energy Monitoring — makine bazında manuel kwh kaydı ve özet. Connector
 * henüz otomatik telemetri göndermediği için okuma elle girilir (sayaç/fatura
 * gibi); özet, aynı aralıktaki ProductionRun.goodCount ile birleşerek parça
 * başına enerji göstergesi de sunar. */
export function EnergyPage() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());
  const [showAdd, setShowAdd] = useState(false);

  const machines = useQuery({
    queryKey: ["/machines"],
    queryFn: () => apiGet<MachineOption[]>("/machines"),
  });
  const query = useQuery({
    queryKey: ["/energy/summary", from, to],
    queryFn: () => apiGet<EnergySummary>(`/energy/summary?from=${from}&to=${to}`),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Zap className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold">Enerji İzleme</h1>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[180px]" />
          <span className="text-slate-400">—</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[180px]" />
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> Kayıt Ekle
          </Button>
        </div>
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {query.error && <p className="text-red-600">Rapor alınamadı.</p>}

      {query.data && (
        <>
          <div className="mb-4">
            <Card>
              <div className="text-xs uppercase text-slate-500">Toplam Tüketim</div>
              <div className="mt-1 text-xl font-bold">{query.data.totalKwh.toFixed(1)} kWh</div>
            </Card>
          </div>

          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <th className="py-2">Tezgah</th>
                  <th className="py-2 text-right">Tüketim (kWh)</th>
                  <th className="py-2 text-right">Sağlam Adet</th>
                  <th className="py-2 text-right">kWh / Parça</th>
                </tr>
              </thead>
              <tbody>
                {query.data.machines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-400">
                      Bu aralıkta enerji kaydı yok.
                    </td>
                  </tr>
                )}
                {query.data.machines.map((m) => (
                  <tr key={m.machineId} className="border-b border-slate-50">
                    <td className="py-2">{m.machineName}</td>
                    <td className="py-2 text-right font-medium">{m.kwh.toFixed(2)}</td>
                    <td className="py-2 text-right">{m.goodCount}</td>
                    <td className="py-2 text-right">{m.kwhPerPart != null ? m.kwhPerPart.toFixed(3) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {showAdd && <AddReadingModal machines={machines.data ?? []} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
