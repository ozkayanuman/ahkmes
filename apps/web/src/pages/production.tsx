import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Play, Save } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { Button, Card, Input, Label, Select } from "../components/ui";

interface RunRow {
  id: string;
  startedAt: string;
  endedAt?: string | null;
  goodCount: number;
  scrapCount: number;
  downtimeNote?: string | null;
  workOrder: {
    id: string;
    woNo: string;
    quantity: string;
    status: string;
    part: { id: string; partNo: string; name: string };
  };
  machine?: { id: string; name: string } | null;
  operator: { id: string; name: string };
}
interface WoOption {
  id: string;
  woNo: string;
  status: string;
  part: { partNo: string; name: string };
}
interface MachineOption {
  id: string;
  name: string;
  isActive: boolean;
}

const onError = (e: unknown) => {
  if (e instanceof ApiError && e.status === 409) {
    alert((e.body as { message?: string } | null)?.message ?? "İşlem çakışması (409)");
  } else alert("İşlem başarısız.");
};

/** Operasyon Takibi — büyük dokunmatik dostu butonlar (ileriki HMI/kiosk temeli) */
export function ProductionPage() {
  const { user } = useAuth();
  const canRun = !!user && ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"].includes(user.role);
  const qc = useQueryClient();
  const [woId, setWoId] = useState("");
  const [machineId, setMachineId] = useState("");

  useInvalidateOn(["productionrun.updated", "workorder.updated"], ["/runs", "/work-orders"]);

  const activeRuns = useQuery({
    queryKey: ["/runs", "active"],
    queryFn: () => apiGet<RunRow[]>("/runs?active=true"),
  });
  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WoOption[]>("/work-orders"),
  });
  const machines = useQuery({
    queryKey: ["/machines"],
    queryFn: () => apiGet<MachineOption[]>("/machines"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/runs"] });
    qc.invalidateQueries({ queryKey: ["/work-orders"] });
  };

  const start = useMutation({
    mutationFn: () =>
      apiPost(`/work-orders/${woId}/runs`, machineId ? { machineId } : {}),
    onSuccess: () => {
      invalidate();
      setWoId("");
      setMachineId("");
    },
    onError,
  });

  const activeWoIds = new Set(activeRuns.data?.map((r) => r.workOrder.id) ?? []);
  const startable = (workOrders.data ?? []).filter(
    (w) =>
      !activeWoIds.has(w.id) &&
      (w.status === "PLANNED" || w.status === "WAITING_MATERIAL" || w.status === "IN_PRODUCTION"),
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Operasyon Takibi</h1>

      {canRun && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Label htmlFor="wo">İş Emri</Label>
              <Select id="wo" value={woId} onChange={(e) => setWoId(e.target.value)}>
                <option value="">Seçin…</option>
                {startable.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.woNo} — {w.part.partNo} {w.part.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-48">
              <Label htmlFor="machine">Tezgah</Label>
              <Select id="machine" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                <option value="">Seçilmedi</option>
                {machines.data
                  ?.filter((m) => m.isActive)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </div>
            <Button
              className="h-12 px-8 text-base"
              disabled={!woId || start.isPending}
              onClick={() => start.mutate()}
            >
              <Play className="h-5 w-5" /> Koşu Başlat
            </Button>
          </div>
        </Card>
      )}

      <h2 className="mb-3 text-lg font-semibold">Aktif Koşular</h2>
      {activeRuns.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {activeRuns.data?.length === 0 && (
        <p className="text-slate-400">Aktif üretim koşusu yok — yukarıdan başlatın.</p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {activeRuns.data?.map((run) => (
          <RunCard key={run.id} run={run} canRun={canRun} onChanged={invalidate} />
        ))}
      </div>
    </div>
  );
}

function RunCard({
  run,
  canRun,
  onChanged,
}: {
  run: RunRow;
  canRun: boolean;
  onChanged: () => void;
}) {
  const [good, setGood] = useState(String(run.goodCount));
  const [scrap, setScrap] = useState(String(run.scrapCount));
  const [note, setNote] = useState(run.downtimeNote ?? "");

  const payload = () => ({
    goodCount: Number(good) || 0,
    scrapCount: Number(scrap) || 0,
    ...(note ? { downtimeNote: note } : {}),
  });

  const save = useMutation({
    mutationFn: () => apiPatch(`/runs/${run.id}`, payload()),
    onSuccess: onChanged,
    onError,
  });
  const complete = useMutation({
    mutationFn: () => apiPost(`/runs/${run.id}/complete`, payload()),
    onSuccess: onChanged,
    onError,
  });

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <Link
            to={`/work-orders/${run.workOrder.id}`}
            className="text-lg font-bold text-brand-700 hover:underline"
          >
            {run.workOrder.woNo}
          </Link>
          <div className="text-sm text-slate-500">
            {run.workOrder.part.partNo} — {run.workOrder.part.name} · hedef{" "}
            {fmtQty(run.workOrder.quantity)}
          </div>
        </div>
        <div className="text-right text-sm text-slate-500">
          <div>{run.machine?.name ?? "Tezgah yok"}</div>
          <div>{run.operator.name}</div>
          <div>{new Date(run.startedAt).toLocaleTimeString("tr-TR")}</div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`good-${run.id}`}>Sağlam Adet</Label>
          <Input
            id={`good-${run.id}`}
            type="number"
            min="0"
            inputMode="numeric"
            className="h-14 text-center text-2xl font-bold"
            value={good}
            onChange={(e) => setGood(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`scrap-${run.id}`}>Hurda Adet</Label>
          <Input
            id={`scrap-${run.id}`}
            type="number"
            min="0"
            inputMode="numeric"
            className="h-14 text-center text-2xl font-bold text-red-600"
            value={scrap}
            onChange={(e) => setScrap(e.target.value)}
          />
        </div>
      </div>
      <div className="mb-4">
        <Label htmlFor={`note-${run.id}`}>Duruş Notu</Label>
        <Input
          id={`note-${run.id}`}
          placeholder="örn. takım değişimi, ayar…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {canRun && (
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="h-14 flex-1 text-base"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            <Save className="h-5 w-5" /> Kaydet
          </Button>
          <Button
            className="h-14 flex-1 text-base"
            disabled={complete.isPending}
            onClick={() => {
              if (confirm("Koşu tamamlansın mı? Girilen adetler kaydedilecek.")) complete.mutate();
            }}
          >
            <CheckCircle2 className="h-5 w-5" /> Koşuyu Tamamla
          </Button>
        </div>
      )}
    </Card>
  );
}
