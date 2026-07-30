import { FileDown } from "lucide-react";
import { useState } from "react";
import { apiDownload } from "../lib/api";
import { Button, Card, Input, Label, Select } from "../components/ui";
import { useToast } from "../components/toast";

const REPORTS = [
  { value: "work-orders", label: "İş Emirleri", endpoint: "/reports/work-orders.csv", filename: "is-emirleri.csv" },
  {
    value: "non-conformances",
    label: "Uygunsuzluklar",
    endpoint: "/reports/non-conformances.csv",
    filename: "uygunsuzluklar.csv",
  },
] as const;

/** Faz J basit Custom Report — sürükle-bırak bir rapor tasarımcısı DEĞİL,
 * mevcut iki tablodan (roadmap notuyla bilinçli olarak sınırlı) filtreli CSV
 * dışa aktarımı. Gerçek Report/Dashboard Designer ayrı bir ileride-faz. */
export function ReportsPage() {
  const [report, setReport] = useState<(typeof REPORTS)[number]["value"]>("work-orders");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  async function download() {
    const cfg = REPORTS.find((r) => r.value === report)!;
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    setDownloading(true);
    try {
      await apiDownload(`${cfg.endpoint}${qs ? `?${qs}` : ""}`, cfg.filename);
    } catch {
      toast("Rapor indirilemedi", "error");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <FileDown className="h-5 w-5" />
        </span>
        <h1 className="text-2xl font-bold">Raporlar</h1>
      </div>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="report">Rapor</Label>
            <Select id="report" value={report} onChange={(e) => setReport(e.target.value as typeof report)}>
              {REPORTS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="status">Durum (opsiyonel)</Label>
            <Input id="status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="örn. OPEN" />
          </div>
          <div>
            <Label htmlFor="from">Başlangıç Tarihi</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to">Bitiş Tarihi</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button disabled={downloading} onClick={download}>
            <FileDown className="h-4 w-4" /> CSV İndir
          </Button>
        </div>
      </Card>
    </div>
  );
}
