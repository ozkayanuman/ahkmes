import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, Maximize2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useInvalidateOn } from "../lib/socket";
import { Button, Card, Label, Select } from "../components/ui";
import { useToast } from "../components/toast";

interface TwinMachine {
  id: string;
  name: string;
  model: string;
  controller?: string | null;
  isActive: boolean;
  lastStatus?: string | null;
  lastEventAt?: string | null;
  posX?: number | null;
  posY?: number | null;
  runtimeHours: number;
  oeeToday: number | null;
  goodCountToday: number;
  scrapCountToday: number;
  energyTodayKwh: number;
  openAlarmCount: number;
  dataQuality?: string | null;
  activeWorkOrder?: { id: string; woNo: string; status: string } | null;
}
interface TwinConnection {
  id: string;
  fromMachineId: string;
  toMachineId: string;
}
interface Layout {
  machines: TwinMachine[];
  connections: TwinConnection[];
}

function oeeContext(plantId: string) {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  return new URLSearchParams({ plantId, from: from.toISOString(), to: now.toISOString(), asOf: now.toISOString() });
}

function statusColor(m: TwinMachine) {
  if (!m.isActive) return { bg: "bg-slate-100", border: "border-slate-400", dot: "bg-slate-400" };
  if (m.lastStatus === "ALARM") return { bg: "bg-red-50", border: "border-red-500", dot: "bg-red-500" };
  if (m.activeWorkOrder) return { bg: "bg-blue-50", border: "border-blue-500", dot: "bg-blue-500" };
  return { bg: "bg-green-50", border: "border-green-500", dot: "bg-green-500" };
}

const CANVAS_W = 1600;
const CANVAS_H = 900;
const ICON_W = 128;
const ICON_H = 72;

/** Digital Twin — 2D saha planı: makineler sürüklenip yerleştirilir, aralarına
 * bağlantı çizilir, her makinenin canlı durumu ve atanmış iş emri anlık görülür.
 * Fiziksel yerleşim (posX/posY) hiyerarşiden bağımsızdır. */
export function DigitalTwinPage() {
  const { user } = useAuth();
  const canEdit = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);

  const onError = (e: unknown) => {
    const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
    toast(msg ?? "İşlem başarısız.", "error");
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plantId, setPlantId] = useState("");
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  useInvalidateOn(
    ["machine.updated", "machine.alarm", "productionrun.updated", "workorder.updated"],
    ["/digital-twin/layout", plantId],
  );

  const plants = useQuery({ queryKey: ["/plants"], queryFn: () => apiGet<{ id: string; name: string }[]>("/plants") });

  const layout = useQuery({
    queryKey: ["/digital-twin/layout", plantId],
    queryFn: () => apiGet<Layout>(`/digital-twin/layout?${oeeContext(plantId)}`),
    enabled: Boolean(plantId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/digital-twin/layout", plantId] });

  const setPosition = useMutation({
    mutationFn: ({ id, posX, posY }: { id: string; posX: number; posY: number }) =>
      apiPatch(`/digital-twin/machines/${id}/position`, { posX, posY }),
    onSuccess: invalidate,
    onError,
  });
  const createConnection = useMutation({
    mutationFn: ({ fromMachineId, toMachineId }: { fromMachineId: string; toMachineId: string }) =>
      apiPost("/digital-twin/connections", { fromMachineId, toMachineId }),
    onSuccess: invalidate,
    onError,
  });
  const removeConnection = useMutation({
    mutationFn: (id: string) => apiDelete(`/digital-twin/connections/${id}`),
    onSuccess: invalidate,
    onError,
  });

  const machines = layout.data?.machines ?? [];
  const connections = layout.data?.connections ?? [];
  const placed = machines.filter((m) => m.posX != null && m.posY != null);
  const unplaced = machines.filter((m) => m.posX == null || m.posY == null);
  const selected = machines.find((m) => m.id === selectedId) ?? null;

  function machinePos(m: TwinMachine) {
    if (dragId === m.id && dragPos) return dragPos;
    return { x: m.posX ?? 0, y: m.posY ?? 0 };
  }

  function startDrag(e: React.PointerEvent, m: TwinMachine) {
    if (!canEdit || connectMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - (m.posX ?? 0);
    const offsetY = e.clientY - rect.top - (m.posY ?? 0);
    setDragId(m.id);
    setDragPos({ x: m.posX ?? 0, y: m.posY ?? 0 });

    function onMove(ev: PointerEvent) {
      const x = Math.max(0, Math.min(CANVAS_W - ICON_W, ev.clientX - rect.left - offsetX));
      const y = Math.max(0, Math.min(CANVAS_H - ICON_H, ev.clientY - rect.top - offsetY));
      setDragPos({ x, y });
    }
    function onUp(ev: PointerEvent) {
      const x = Math.max(0, Math.min(CANVAS_W - ICON_W, ev.clientX - rect.left - offsetX));
      const y = Math.max(0, Math.min(CANVAS_H - ICON_H, ev.clientY - rect.top - offsetY));
      setPosition.mutate({ id: m.id, posX: Math.round(x), posY: Math.round(y) });
      setDragId(null);
      setDragPos(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function placeUnplaced(m: TwinMachine) {
    setPosition.mutate({ id: m.id, posX: 40, posY: 40 + (unplaced.indexOf(m) % 4) * 100 });
  }

  function handleMachineClick(m: TwinMachine) {
    if (connectMode) {
      if (!connectFrom) {
        setConnectFrom(m.id);
      } else if (connectFrom !== m.id) {
        createConnection.mutate({ fromMachineId: connectFrom, toMachineId: m.id });
        setConnectFrom(null);
      }
      return;
    }
    setSelectedId(m.id);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Digital Twin — Saha Planı</h1>
        <div className="flex gap-2">
          <div className="w-48">
            <Label htmlFor="digital-twin-plant">Tesis</Label>
            <Select id="digital-twin-plant" value={plantId} onChange={(event) => { setPlantId(event.target.value); setSelectedId(null); }}>
              <option value="">Tesis seÃ§in</option>
              {(plants.data ?? []).map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
            </Select>
          </div>
          <Link to="/andon" target="_blank" rel="noopener">
            <Button variant="outline">
              <Maximize2 className="h-4 w-4" /> Tam Ekran İzleme
            </Button>
          </Link>
          {canEdit && (
            <Button
              variant={connectMode ? "primary" : "outline"}
              onClick={() => {
                setConnectMode((v) => !v);
                setConnectFrom(null);
              }}
            >
              <Cable className="h-4 w-4" /> {connectMode ? "Bağlantı Modu (Aktif)" : "Bağlantı Kur"}
            </Button>
          )}
        </div>
      </div>

      {connectMode && (
        <p className="mb-3 text-sm text-slate-500">
          Bağlantı kurmak için sırayla iki makineye tıklayın. {connectFrom && "İlk makine seçildi, ikinciyi seçin…"}
        </p>
      )}

      {canEdit && unplaced.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-600">Yerleştirilmemiş Makineler</h2>
          <div className="flex flex-wrap gap-2">
            {unplaced.map((m) => (
              <button
                key={m.id}
                onClick={() => placeUnplaced(m)}
                className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-brand-500 hover:text-brand-700"
              >
                + {m.name}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="flex gap-4">
        <div
          ref={canvasRef}
          className="relative overflow-auto rounded-lg border border-slate-200 bg-slate-50"
          style={{
            width: "100%",
            maxWidth: CANVAS_W,
            height: CANVAS_H,
            backgroundImage:
              "linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        >
          <svg className="pointer-events-none absolute left-0 top-0" width={CANVAS_W} height={CANVAS_H}>
            {connections.map((c) => {
              const from = machines.find((m) => m.id === c.fromMachineId);
              const to = machines.find((m) => m.id === c.toMachineId);
              if (!from || !to || from.posX == null || to.posX == null) return null;
              const x1 = from.posX + ICON_W / 2;
              const y1 = from.posY! + ICON_H / 2;
              const x2 = to.posX + ICON_W / 2;
              const y2 = to.posY! + ICON_H / 2;
              return (
                <g
                  key={c.id}
                  className="pointer-events-auto cursor-pointer"
                  onClick={() => canEdit && removeConnection.mutate(c.id)}
                >
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 4" />
                </g>
              );
            })}
          </svg>

          {placed.map((m) => {
            const pos = machinePos(m);
            const style = statusColor(m);
            const isConnectSource = connectFrom === m.id;
            return (
              <div
                key={m.id}
                onPointerDown={(e) => startDrag(e, m)}
                onClick={() => handleMachineClick(m)}
                className={`absolute flex cursor-pointer select-none flex-col justify-center rounded-lg border-2 px-3 py-2 shadow-sm transition-shadow hover:shadow-md ${style.bg} ${
                  isConnectSource ? "border-brand-600 ring-2 ring-brand-300" : style.border
                } ${selectedId === m.id ? "ring-2 ring-offset-1" : ""}`}
                style={{ left: pos.x, top: pos.y, width: ICON_W, height: ICON_H }}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                  <span className="truncate text-sm font-semibold text-slate-800">{m.name}</span>
                </div>
                <span className="truncate text-xs text-slate-500">{m.model}</span>
                {m.activeWorkOrder && (
                  <span className="mt-0.5 truncate text-xs font-medium text-blue-700">{m.activeWorkOrder.woNo}</span>
                )}
              </div>
            );
          })}
        </div>

        {selected && (
          <Card className="h-fit w-72 shrink-0">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              <button onClick={() => setSelectedId(null)} className="rounded p-1 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-slate-500">Model</dt>
                <dd>{selected.model}</dd>
              </div>
              {selected.controller && (
                <div>
                  <dt className="text-slate-500">Kontrolcü</dt>
                  <dd>{selected.controller}</dd>
                </div>
              )}
              <div>
                <dt className="text-slate-500">Durum</dt>
                <dd>
                  {!selected.isActive
                    ? "Pasif"
                    : selected.lastStatus === "ALARM"
                      ? "Alarm"
                      : selected.activeWorkOrder
                        ? "Üretimde"
                        : "Boşta"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Atanmış İş Emri</dt>
                <dd>{selected.activeWorkOrder?.woNo ?? "—"}</dd>
              </div>
              <div className="border-t border-slate-100 pt-2">
                <dt className="text-slate-500">Bugünkü OEE</dt>
                <dd className="font-semibold">
                  {selected.oeeToday != null ? `%${(selected.oeeToday * 100).toFixed(0)}` : "—"}
                  <span className="ml-1 font-normal text-slate-400">
                    ({selected.goodCountToday} sağlam / {selected.scrapCountToday} hurda)
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Kümülatif Çalışma Süresi</dt>
                <dd>{selected.runtimeHours.toFixed(1)} saat</dd>
              </div>
              <div>
                <dt className="text-slate-500">Bugünkü Enerji Tüketimi</dt>
                <dd>{selected.energyTodayKwh.toFixed(2)} kWh</dd>
              </div>
              {selected.openAlarmCount > 0 && (
                <div>
                  <dt className="text-slate-500">Açık Alarmlar</dt>
                  <dd className="font-semibold text-red-600">{selected.openAlarmCount}</dd>
                </div>
              )}
            </dl>
          </Card>
        )}
      </div>
    </div>
  );
}
