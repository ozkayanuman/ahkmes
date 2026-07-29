import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Printer } from "lucide-react";
import { useState } from "react";
import { apiGet } from "../lib/api";
import { Button, Card, Input } from "../components/ui";

interface ShiftSummary {
  shift: number;
  label: string;
  start: string;
  end: string;
  goodCount: number;
  scrapCount: number;
  quality: number | null;
  performance: number | null;
  availability: number | null;
  oee: number | null;
  downtimeSeconds: number;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}s ${m}dk`;
  if (m > 0) return `${m}dk`;
  return `${seconds}sn`;
}

function pct(v: number | null) {
  return v != null ? `%${(v * 100).toFixed(0)}` : "—";
}

/** Vardiya raporu — MES ürünlerinin çekirdek özelliği olan vardiya bazlı üretim
 * özeti: sabit 3 vardiya (06-14 / 14-22 / 22-06) için goodCount/scrapCount, OEE
 * bileşenleri ve toplam duruş süresi. Vardiya yönetimi CRUD'u bu sürümde yok. */
export function ShiftReportPage() {
  const [date, setDate] = useState(todayIso());

  const query = useQuery({
    queryKey: ["/shift-report", date],
    queryFn: () => apiGet<ShiftSummary[]>(`/shift-report?date=${date}`),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <CalendarClock className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold">Vardiya Raporu</h1>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[180px]" />
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Yazdır / PDF
          </Button>
        </div>
      </div>

      <div className="mb-4 hidden print:block">
        <h1 className="text-xl font-bold">AHKMES — Vardiya Raporu</h1>
        <p className="text-sm text-slate-500">
          Tarih: {date} · Oluşturulma: {new Date().toLocaleString("tr-TR")}
        </p>
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {query.error && <p className="text-red-600">Rapor alınamadı.</p>}

      {query.data && (
        <div className="grid gap-4 md:grid-cols-3 print:grid-cols-3 print:gap-2">
          {query.data.map((s) => (
            <Card key={s.shift}>
              <div className="mb-3 text-sm font-semibold text-slate-700">{s.label}</div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Sağlam / Hurda</dt>
                  <dd className="font-medium">
                    {s.goodCount} / <span className="text-red-600">{s.scrapCount}</span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Kalite</dt>
                  <dd className="font-medium">{pct(s.quality)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Performans</dt>
                  <dd className="font-medium">{pct(s.performance)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Kullanılabilirlik</dt>
                  <dd className="font-medium">{pct(s.availability)}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2">
                  <dt className="font-semibold text-slate-600">OEE</dt>
                  <dd className="font-bold text-slate-800">{pct(s.oee)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Duruş Süresi</dt>
                  <dd className="font-medium">{fmtDuration(s.downtimeSeconds)}</dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
