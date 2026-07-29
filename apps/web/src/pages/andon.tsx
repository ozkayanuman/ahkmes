import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Gauge, PauseCircle, PowerOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { clsx } from "clsx";
import { apiGet } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useInvalidateOn } from "../lib/socket";

interface AndonMachine {
  id: string;
  name: string;
  model: string;
  isActive: boolean;
  lastStatus?: string | null;
  lastEventAt?: string | null;
  activeWorkOrder?: { id: string; woNo: string; status: string } | null;
}
interface Layout {
  machines: AndonMachine[];
}

type Tone = "running" | "idle" | "alarm" | "offline";

function toneOf(m: AndonMachine): Tone {
  if (!m.isActive) return "offline";
  if (m.lastStatus === "ALARM") return "alarm";
  if (m.activeWorkOrder) return "running";
  return "idle";
}

const TONE_STYLE: Record<Tone, { border: string; bg: string; text: string; label: string; icon: typeof Gauge }> = {
  running: { border: "border-green-500", bg: "bg-green-950/40", text: "text-green-400", label: "ÇALIŞIYOR", icon: Gauge },
  idle: { border: "border-amber-500", bg: "bg-amber-950/30", text: "text-amber-400", label: "BOŞTA", icon: PauseCircle },
  alarm: { border: "border-red-500", bg: "bg-red-950/50", text: "text-red-400", label: "ALARM", icon: AlertTriangle },
  offline: { border: "border-slate-700", bg: "bg-slate-900", text: "text-slate-500", label: "BAĞLI DEĞİL", icon: PowerOff },
};

/** Andon panosu — vardiya salonundaki büyük ekran/TV için tasarlanmış tam ekran
 * izleme modu. Sidebar/menü içermez, dokunmatik değil, otomatik yenilenir; Digital
 * Twin'in aynı canlı verisini (posX/posY olmadan) kartlar halinde büyük puntoyla gösterir. */
export function AndonPage() {
  const { user, loading } = useAuth();
  const [now, setNow] = useState(new Date());

  useInvalidateOn(
    ["machine.updated", "machine.alarm", "productionrun.updated", "workorder.updated"],
    ["/digital-twin/layout"],
  );
  const layout = useQuery({
    queryKey: ["/digital-twin/layout"],
    queryFn: () => apiGet<Layout>("/digital-twin/layout"),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const machines = layout.data?.machines ?? [];
  const alarmCount = machines.filter((m) => toneOf(m) === "alarm").length;

  return (
    <div className="min-h-screen bg-black p-6 text-white">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/digital-twin" className="rounded-md p-2 text-slate-500 hover:bg-slate-900 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold tracking-wide">AHKMES — Canlı İzleme</h1>
        </div>
        <div className="flex items-center gap-6">
          {alarmCount > 0 && (
            <span className="flex items-center gap-2 rounded-full bg-red-950/60 px-4 py-1.5 text-red-400">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
              <span className="font-bold">{alarmCount} ALARM</span>
            </span>
          )}
          <span className="font-mono text-3xl tabular-nums text-slate-300">
            {now.toLocaleTimeString("tr-TR")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {machines.map((m) => {
          const tone = toneOf(m);
          const s = TONE_STYLE[tone];
          const Icon = s.icon;
          return (
            <div
              key={m.id}
              className={clsx(
                "rounded-2xl border-2 p-5 shadow-lg transition-colors",
                s.border,
                s.bg,
                tone === "alarm" && "animate-pulse",
              )}
            >
              <div className="mb-3 flex items-center justify-between">
                <Icon className={clsx("h-8 w-8", s.text)} />
                <span className={clsx("rounded-full px-3 py-1 text-xs font-bold tracking-wider", s.text)}>
                  {s.label}
                </span>
              </div>
              <div className="truncate text-2xl font-bold">{m.name}</div>
              <div className="truncate text-sm text-slate-400">{m.model}</div>
              <div className="mt-3 truncate text-lg font-semibold text-slate-200">
                {m.activeWorkOrder?.woNo ?? "—"}
              </div>
            </div>
          );
        })}
        {machines.length === 0 && (
          <p className="col-span-full py-20 text-center text-slate-500">Tanımlı tezgah yok</p>
        )}
      </div>
    </div>
  );
}
