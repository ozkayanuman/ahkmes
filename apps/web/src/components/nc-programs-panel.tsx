import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
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

  const queryKey = ["/parts", partId, "nc-programs"];
  const list = useQuery({
    queryKey,
    queryFn: () => apiGet<NcProgramRow[]>(`/parts/${partId}/nc-programs`),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const created = await apiPost<{ id: string }>(`/parts/${partId}/nc-programs`, {
        fileName: file.name,
        fileRef: file.name,
      });
      return apiUpload(`/nc-programs/${created.id}/file`, file);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setErr(null);
      if (fileRef.current) fileRef.current.value = "";
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

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">NC Programları (G-kod)</h2>
      {canWrite && (
        <div className="mb-3 flex items-end gap-2">
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
      <Table headers={["Versiyon", "Dosya", "Boyut", "Tarih", ""]}>
        {list.data?.length === 0 && (
          <tr>
            <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
              Program yok
            </td>
          </tr>
        )}
        {list.data?.map((p) => (
          <tr key={p.id} className="hover:bg-slate-50">
            <td className="px-4 py-3">v{p.version}</td>
            <td className="px-4 py-3">{p.fileName}</td>
            <td className="px-4 py-3">{fmtSize(p.sizeBytes)}</td>
            <td className="px-4 py-3">{fmtDate(p.createdAt)}</td>
            <td className="px-4 py-3">
              {p.storageKey && (
                <Button variant="ghost" className="px-2 py-1" title="İndir" onClick={() => download(p)}>
                  <Download className="h-4 w-4" />
                </Button>
              )}
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
