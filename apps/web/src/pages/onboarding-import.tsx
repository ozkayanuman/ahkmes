import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileCheck2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Card, Select, Table } from "../components/ui";
import { ApiError, apiDownload, apiGet, apiPost, apiUpload } from "../lib/api";
import { useConfirm } from "../components/confirm-dialog";
import { useToast } from "../components/toast";

type Template = { template: string; required: string[]; optional: string[] };
type RowResult = { id: string; rowNumber: number; externalKey?: string | null; status: string; errors?: string[] | null };
type Batch = { id: string; template: string; status: string; totalRows: number; validRows: number; createdRows: number; failureReason?: string | null; createdAt: string; createdBy?: { name: string; email: string }; rowResults?: RowResult[] };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? String((error.body as { message?: string } | null)?.message ?? fallback) : fallback;
}

function downloadTemplate(template: Template) {
  const url = URL.createObjectURL(new Blob([`${[...template.required, ...template.optional].join(",")}\n`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `ahkmes-${template.template.toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function OnboardingImportPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState("PARTS");
  const [detailId, setDetailId] = useState<string | null>(null);
  const templates = useQuery({ queryKey: ["/onboarding-import/templates"], queryFn: () => apiGet<Template[]>("/onboarding-import/templates") });
  const batches = useQuery({ queryKey: ["/onboarding-import/batches"], queryFn: () => apiGet<Batch[]>("/onboarding-import/batches") });
  const detail = useQuery({ queryKey: ["/onboarding-import/batches", detailId], queryFn: () => apiGet<Batch>(`/onboarding-import/batches/${detailId}`), enabled: Boolean(detailId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/onboarding-import/batches"] });
  const dryRun = useMutation({
    mutationFn: (file: File) => apiUpload<Batch>(`/onboarding-import/${selected}/dry-run`, file),
    onSuccess: async (batch) => { setDetailId(batch.id); await refresh(); toast(batch.status === "VALIDATED" ? "Dosya doğrulandı; şimdi satırları gözden geçirip onaylayın." : "Dosyada hata bulundu; satır ayrıntılarını düzeltin.", batch.status === "VALIDATED" ? "success" : "error"); },
    onError: (error) => toast(errorMessage(error, "CSV doğrulanamadı"), "error"),
  });
  const commit = useMutation({
    mutationFn: (id: string) => apiPost<Batch>(`/onboarding-import/batches/${id}/commit`, {}),
    onSuccess: async () => { await refresh(); await queryClient.invalidateQueries({ queryKey: ["/onboarding-import/batches", detailId] }); toast("Doğrulanmış batch atomik olarak işlendi.", "success"); },
    onError: (error) => toast(errorMessage(error, "Batch işlenemedi"), "error"),
  });
  const chosen = templates.data?.find((template) => template.template === selected);
  const active = detail.data;
  const canCommit = active?.status === "VALIDATED" && active.validRows === active.totalRows;
  const hasRowErrors = Boolean(active?.rowResults?.some((row) => row.status === "ERROR"));
  const onFile = (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { toast("Yalnızca CSV dosyası seçin.", "error"); return; }
    dryRun.mutate(file);
  };
  const commitActive = async () => {
    if (!active || !canCommit) return;
    if (await confirm({ message: `${active.totalRows} doğrulanmış satır oluşturulacak. Açılış stoğu kanonik hareket kaydı üretir; işlem geri alınamaz.`, danger: true })) commit.mutate(active.id);
  };

  return <div className="space-y-6">
    <header><h1 className="text-2xl font-bold">Müşteri Veri Onboarding</h1><p className="mt-1 text-sm text-slate-600">Önce CSV dosyasını doğrulayın; sistem ancak hatasız batch için, açık onaydan sonra atomik kayıt oluşturur. Mevcut kayıtlar güncellenmez.</p></header>
    <Card className="p-4"><div className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end"><div><label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="onboarding-template">Şablon</label><Select id="onboarding-template" value={selected} onChange={(event) => setSelected(event.target.value)}>{(templates.data ?? []).map((template) => <option key={template.template} value={template.template}>{template.template}</option>)}</Select></div><Button variant="outline" disabled={!chosen} onClick={() => chosen && downloadTemplate(chosen)}><Download className="h-4 w-4" /> Boş şablonu indir</Button><Button disabled={dryRun.isPending || !chosen} onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" /> {dryRun.isPending ? "Doğrulanıyor…" : "CSV seç ve doğrula"}</Button></div><input ref={inputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => { onFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />{chosen && <div className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-600"><p><span className="font-semibold">Zorunlu:</span> {chosen.required.join(", ")}</p>{chosen.optional.length > 0 && <p className="mt-1"><span className="font-semibold">Opsiyonel:</span> {chosen.optional.join(", ")}</p>}{selected === "OPENING_STOCK" && <p className="mt-2 text-amber-800">Açılış stoğu için malzeme/parça, depo ve raf daha önce oluşturulmuş olmalıdır. Depo şablonu yalnızca depo kaydı oluşturur.</p>}</div>}</Card>
    {active && <Card className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Batch ayrıntısı · {active.template}</h2><p className="mt-1 text-sm text-slate-600">Durum: <span className={active.status === "VALIDATED" || active.status === "COMMITTED" ? "font-medium text-green-700" : "font-medium text-red-700"}>{active.status}</span> · {active.validRows}/{active.totalRows} satır geçerli</p>{active.failureReason && <p className="mt-1 text-sm text-red-700">{active.failureReason}</p>}</div><div className="flex flex-wrap gap-2">{hasRowErrors && <Button size="sm" variant="outline" onClick={() => apiDownload(`/onboarding-import/batches/${active.id}/errors.csv`, `ahkmes-${active.template.toLowerCase()}-hatalari.csv`).catch((error) => toast(errorMessage(error, "Hata CSV dosyası indirilemedi"), "error"))}><Download className="h-4 w-4" /> Hataları CSV indir</Button>}{canCommit && <Button disabled={commit.isPending} onClick={commitActive}><FileCheck2 className="h-4 w-4" /> {commit.isPending ? "İşleniyor…" : "Doğrulanmış batch’i işle"}</Button>}</div></div><div className="mt-4 max-h-72 overflow-auto"><Table headers={["Satır", "İş anahtarı", "Durum", "Hatalar"]}>{(active.rowResults ?? []).map((row) => <tr key={row.id}><td>{row.rowNumber}</td><td className="font-mono text-xs">{row.externalKey ?? "—"}</td><td>{row.status}</td><td className="text-xs text-red-700">{row.errors?.join("; ") ?? "—"}</td></tr>)}</Table></div></Card>}
    <section><h2 className="mb-3 text-lg font-semibold">İçe aktarma geçmişi</h2><Table headers={["Tarih", "Şablon", "Durum", "Geçerli", "Oluşturulan", "Kullanıcı", ""]}>{(batches.data ?? []).map((batch) => <tr key={batch.id}><td>{new Date(batch.createdAt).toLocaleString("tr-TR")}</td><td>{batch.template}</td><td>{batch.status}</td><td>{batch.validRows}/{batch.totalRows}</td><td>{batch.createdRows}</td><td>{batch.createdBy?.name ?? batch.createdBy?.email ?? "—"}</td><td><Button size="sm" variant="outline" onClick={() => setDetailId(batch.id)}>İncele</Button></td></tr>)}</Table>{batches.data?.length === 0 && <p className="mt-2 text-sm text-slate-500">Henüz içe aktarma batch’i yok.</p>}</section>
  </div>;
}
