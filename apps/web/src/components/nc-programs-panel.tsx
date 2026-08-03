import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Send, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { ApiError, apiGet, apiPost, apiUpload } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Table } from "./ui";

interface NcProgramRow {
  id: string;
  version: number;
  fileName: string;
  storageKey?: string | null;
  sizeBytes?: number | null;
  checksum: string;
  status: "DRAFT" | "REVIEW" | "APPROVED" | "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";
  effectivityScope: string;
  createdAt: string;
}

function fmtSize(bytes?: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function NcProgramsPanel({ partId }: { partId: string }) {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [revisionSource, setRevisionSource] = useState<NcProgramRow | null>(null);
  const statusLabel: Record<NcProgramRow["status"], string> = { DRAFT: "Taslak", REVIEW: "İncelemede", APPROVED: "Onaylı", PUBLISHED: "Yayınlı", SUPERSEDED: "Üst revizyon var", ARCHIVED: "Arşiv" };

  const queryKey = ["/parts", partId, "nc-programs"];
  const list = useQuery({
    queryKey,
    queryFn: () => apiGet<NcProgramRow[]>(`/parts/${partId}/nc-programs`),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const created = revisionSource
        ? await apiPost<{ id: string }>(`/nc-programs/${revisionSource.id}/revisions`, { fileName: file.name, fileRef: file.name })
        : await apiPost<{ id: string }>(`/parts/${partId}/nc-programs`, { fileName: file.name, fileRef: file.name });
      return apiUpload(`/nc-programs/${created.id}/file`, file);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setErr(null);
      if (fileRef.current) fileRef.current.value = "";
      setRevisionSource(null);
    },
    onError: (e) => {
      const msg =
        e instanceof ApiError && (e.body as { message?: string } | null)?.message
          ? (e.body as { message: string }).message
          : "Yükleme başarısız";
      setErr(msg);
    },
  });

  async function download(program: NcProgramRow) {
    const res = await apiGet<{ url: string }>(`/nc-programs/${program.id}/url`);
    window.open(res.url, "_blank", "noopener,noreferrer");
  }

  const lifecycle = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "submit-review" | "approve" | "publish" | "archive" }) => {
      if (action === "submit-review") return apiPost(`/nc-programs/${id}/submit-review`, {});
      if (action === "archive") return apiPost(`/nc-programs/${id}/archive`, {});
      const password = window.prompt(action === "approve" ? "Onay için şifrenizi girin" : "Yayın için şifrenizi girin");
      if (!password) throw new Error("Elektronik imza için yeniden kimlik doğrulama gerekli");
      return apiPost(`/nc-programs/${id}/${action}`, { password });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey }); setErr(null); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Yaşam döngüsü işlemi başarısız"),
  });

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">NC Programları (G-kod)</h2>
      {canWrite && (
        <div className="mb-3 flex items-end gap-2">
          {revisionSource && <span className="text-sm font-medium text-brand-700">v{revisionSource.version} için yeni revizyon dosyası seçin</span>}
          <input
            ref={fileRef}
            type="file"
            className="text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
            }}
          />
          {upload.isPending && <span className="text-sm text-slate-500">Yükleniyor…</span>}
        </div>
      )}
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      <p className="mb-3 text-sm text-slate-500">Dosya SHA-256 ile sabitlenir. Yayınlı içerik değiştirilemez; değişiklik için yeni revizyon açılır.</p>
      <Table headers={["Versiyon", "Durum", "Dosya / SHA-256", "Kapsam", "Tarih", ""]}>
        {list.data?.length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
              Program yok
            </td>
          </tr>
        )}
        {list.data?.map((p) => (
          <tr key={p.id} className="hover:bg-slate-50">
            <td className="px-4 py-3">v{p.version}</td>
            <td className="px-4 py-3"><span className={p.status === "PUBLISHED" ? "font-medium text-emerald-700" : "text-slate-600"}>{statusLabel[p.status]}</span></td>
            <td className="px-4 py-3"><div>{p.fileName} <span className="text-xs text-slate-400">{fmtSize(p.sizeBytes)}</span></div><code className="block max-w-44 truncate text-xs text-slate-400" title={p.checksum}>{p.checksum || "checksum bekliyor"}</code></td>
            <td className="px-4 py-3 text-xs">{p.effectivityScope}</td>
            <td className="px-4 py-3">{fmtDate(p.createdAt)}</td>
            <td className="px-4 py-3">
              {p.storageKey && (
                <Button variant="ghost" className="px-2 py-1" title="İndir" onClick={() => download(p)}>
                  <Download className="h-4 w-4" />
                </Button>
              )}
              {canWrite && p.status !== "DRAFT" && <Button variant="ghost" className="px-2 py-1 text-xs" title="Bu sürümden yeni revizyon oluştur" onClick={() => { setRevisionSource(p); fileRef.current?.click(); }}>Revize</Button>}
              {canWrite && p.status === "DRAFT" && p.storageKey && <Button variant="ghost" className="px-2 py-1" title="İncelemeye gönder" onClick={() => lifecycle.mutate({ id: p.id, action: "submit-review" })}><Send className="h-4 w-4" /></Button>}
              {user?.role === "ADMIN" && p.status === "REVIEW" && <Button variant="ghost" className="px-2 py-1" title="Elektronik imzayla onayla" onClick={() => lifecycle.mutate({ id: p.id, action: "approve" })}><CheckCircle2 className="h-4 w-4" /></Button>}
              {canWrite && p.status === "APPROVED" && <Button variant="ghost" className="px-2 py-1" title="Elektronik imzayla yayınla" onClick={() => lifecycle.mutate({ id: p.id, action: "publish" })}><Upload className="h-4 w-4" /></Button>}
              {canWrite && ["DRAFT", "APPROVED", "SUPERSEDED"].includes(p.status) && <Button variant="ghost" className="px-2 py-1 text-xs" title="Arşivle" onClick={() => lifecycle.mutate({ id: p.id, action: "archive" })}>Arşivle</Button>}
            </td>
          </tr>
        ))}
      </Table>
      {canWrite && !list.data?.length && (
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-400">
          <Upload className="h-3 w-3" /> Dosya seçerek yeni versiyon yükleyin.
        </p>
      )}
    </div>
  );
}
