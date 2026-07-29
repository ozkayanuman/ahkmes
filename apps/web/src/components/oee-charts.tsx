interface TrendPoint {
  date: string;
  quality: number | null;
  performance: number | null;
  availability: number | null;
  oee: number | null;
  downtimeSeconds: number;
}

interface ParetoEntry {
  reason: string;
  totalSeconds: number;
  count: number;
}

const CHART_W = 640;
const CHART_H = 200;
const PAD_L = 32;
const PAD_B = 24;
const PAD_T = 12;

/** Sektörde "world-class OEE" eşiği olarak kabul edilen %85 ve %60 sınırlarına göre renk. */
function oeeColor(oee: number) {
  if (oee >= 0.85) return "#16a34a";
  if (oee >= 0.6) return "#f59e0b";
  return "#dc2626";
}

function fmtDay(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
}

export function OeeTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">Bu dönemde üretim verisi yok</p>;
  }

  const plotW = CHART_W - PAD_L - 8;
  const plotH = CHART_H - PAD_T - PAD_B;
  const barW = Math.min(28, plotW / data.length - 6);

  const avgOee = avg(data.map((d) => d.oee));
  const avgQuality = avg(data.map((d) => d.quality));
  const avgPerformance = avg(data.map((d) => d.performance));
  const avgAvailability = avg(data.map((d) => d.availability));

  return (
    <div>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" role="img" aria-label="OEE trend grafiği">
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = PAD_T + plotH * (1 - frac);
          return (
            <g key={frac}>
              <line x1={PAD_L} y1={y} x2={CHART_W - 8} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={PAD_L - 6} y={y + 3} fontSize={9} textAnchor="end" fill="#94a3b8">
                {Math.round(frac * 100)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = PAD_L + (i + 0.5) * (plotW / data.length) - barW / 2;
          const h = (d.oee ?? 0) * plotH;
          const y = PAD_T + plotH - h;
          return (
            <g key={d.date}>
              {d.oee !== null ? (
                <rect x={x} y={y} width={barW} height={h} rx={2} fill={oeeColor(d.oee)}>
                  <title>{`${fmtDay(d.date)}: OEE ${(d.oee * 100).toFixed(0)}%`}</title>
                </rect>
              ) : (
                <rect x={x} y={PAD_T + plotH - 3} width={barW} height={3} rx={1.5} fill="#cbd5e1">
                  <title>{`${fmtDay(d.date)}: veri yok`}</title>
                </rect>
              )}
              <text x={x + barW / 2} y={CHART_H - 6} fontSize={9} textAnchor="middle" fill="#94a3b8">
                {fmtDay(d.date)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 grid grid-cols-4 gap-2 border-t border-slate-100 pt-2 text-center text-xs">
        <Stat label="Ort. OEE" value={avgOee} highlight />
        <Stat label="Kalite" value={avgQuality} />
        <Stat label="Performans" value={avgPerformance} />
        <Stat label="Kullanılabilirlik" value={avgAvailability} />
      </div>
    </div>
  );
}

function avg(values: (number | null)[]) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((s, v) => s + v, 0) / present.length;
}

function Stat({ label, value, highlight }: { label: string; value: number | null; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={highlight ? "font-bold text-slate-800" : "font-medium text-slate-600"}>
        {value !== null ? `${(value * 100).toFixed(0)}%` : "—"}
      </div>
    </div>
  );
}

function fmtDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}s ${m}dk`;
  if (m > 0) return `${m}dk`;
  return `${seconds}sn`;
}

export function DowntimeParetoChart({ data }: { data: ParetoEntry[] }) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">Bu dönemde duruş kaydı yok</p>;
  }
  const top = data.slice(0, 8);
  const total = data.reduce((s, d) => s + d.totalSeconds, 0);
  const max = Math.max(...top.map((d) => d.totalSeconds));
  let cumulative = 0;

  return (
    <div className="space-y-2">
      {top.map((d) => {
        cumulative += d.totalSeconds;
        const pct = max > 0 ? (d.totalSeconds / max) * 100 : 0;
        const cumPct = total > 0 ? (cumulative / total) * 100 : 0;
        return (
          <div key={d.reason} className="flex items-center gap-3 text-xs">
            <div className="w-28 shrink-0 truncate text-slate-600" title={d.reason}>
              {d.reason}
            </div>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full rounded bg-red-400"
                style={{ width: `${pct}%` }}
                title={`${fmtDuration(d.totalSeconds)} · ${d.count} olay`}
              />
            </div>
            <div className="w-20 shrink-0 text-right font-medium text-slate-700">
              {fmtDuration(d.totalSeconds)}
            </div>
            <div className="w-12 shrink-0 text-right text-slate-400">%{cumPct.toFixed(0)}</div>
          </div>
        );
      })}
    </div>
  );
}
