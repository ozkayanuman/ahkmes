import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Gauge, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { apiGet } from "../lib/api";
import { useInvalidateOn } from "../lib/socket";

interface StatusBarData {
  oeeToday: number | null;
  openNonConformanceCount: number;
  activeAlarmCount: number;
}

/** Kurumsal MES ürünlerinde standart olan, tüm sayfalarda sabit kalan üst durum
 * şeridi — anlık fabrika sağlığını (OEE, açık uygunsuzluk, aktif alarm) her zaman
 * görünür tutar; her sayfada ayrı ayrı yeniden uygulanmaz, layout seviyesinde tektir. */
export function GlobalStatusBar() {
  const query = useQuery({
    queryKey: ["/dashboard", "status-bar"],
    queryFn: () => apiGet<StatusBarData>("/dashboard/status-bar"),
    refetchInterval: 30_000,
  });
  useInvalidateOn(
    ["machine.alarm", "machine.updated", "nonconformance.updated", "productionrun.updated"],
    ["/dashboard"],
  );

  const d = query.data;
  const hasAlarm = !!d && d.activeAlarmCount > 0;
  const hasOpenNc = !!d && d.openNonConformanceCount > 0;

  return (
    <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 flex items-center gap-4 border-b border-slate-200 bg-white/95 px-6 py-2 text-sm backdrop-blur">
      <StatBadge
        icon={Gauge}
        label="OEE (Bugün)"
        value={d?.oeeToday != null ? `%${(d.oeeToday * 100).toFixed(0)}` : "—"}
        tone="neutral"
      />
      <Link to="/non-conformances">
        <StatBadge
          icon={ShieldAlert}
          label="Açık Uygunsuzluk"
          value={d ? String(d.openNonConformanceCount) : "—"}
          tone={hasOpenNc ? "warning" : "neutral"}
        />
      </Link>
      <Link to="/machines">
        <StatBadge
          icon={AlertTriangle}
          label="Aktif Alarm"
          value={d ? String(d.activeAlarmCount) : "—"}
          tone={hasAlarm ? "danger" : "neutral"}
          pulse={hasAlarm}
        />
      </Link>
    </div>
  );
}

const TONE_CLS = {
  neutral: "text-slate-600",
  warning: "text-amber-600",
  danger: "text-red-600",
} as const;

function StatBadge({
  icon: Icon,
  label,
  value,
  tone,
  pulse,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  tone: keyof typeof TONE_CLS;
  pulse?: boolean;
}) {
  return (
    <div className={clsx("flex items-center gap-1.5 rounded-md px-2 py-1", tone !== "neutral" && "bg-slate-50")}>
      <span className="relative flex h-4 w-4 items-center justify-center">
        {pulse && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-50" />
        )}
        <Icon className={clsx("relative h-4 w-4", TONE_CLS[tone])} />
      </span>
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className={clsx("font-bold", TONE_CLS[tone])}>{value}</span>
    </div>
  );
}
