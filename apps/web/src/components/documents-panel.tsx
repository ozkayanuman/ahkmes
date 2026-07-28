import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { DocumentEntityType, DocumentType } from "@ahkmes/shared-types";
import { ApiError, apiDelete, apiGet, apiUpload } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Modal, Select, Table } from "./ui";
import { FilePreview } from "./file-preview";

interface DocumentRow {
  id: string;
  docType: DocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy?: { name: string };
}

const DOC_TYPE_LABEL: Record<DocumentType, string> = {
  STEP: "STEP",
  WORK_INSTRUCTION: "Talimat",
  OTHER: "Diğer",
};

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsPanel({
  entityType,
  entityId,
}: {
  entityType: DocumentEntityType;
  entityId: string;
}) {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<DocumentType>("STEP");
  const [err, setErr] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null);

  const queryKey = ["/documents", entityType, entityId];
  const list = useQuery({
    queryKey,
    queryFn: () =>
      apiGet<DocumentRow[]>(`/documents?entityType=${entityType}&entityId=${entityId}`),
  });

  const upload = useMutation({
    mutationFn: (file: File) =>
      apiUpload(`/documents?entityType=${entityType}&entityId=${entityId}&docType=${docType}`, file),
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

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: () => alert("Silinemedi"),
  });

  async function download(doc: DocumentRow) {
    const res = await apiGet<{ url: string }>(`/documents/${doc.id}/url`);
    window.open(res.url, "_blank", "noopener,noreferrer");
  }

  // Önizleme için "inline" gösterime izin veren ayrı bir signed URL istenir —
  // indirme linki her zaman attachment zorlar (bkz. backend güvenlik notu).
  const previewUrl = useQuery({
    queryKey: ["/documents", previewDoc?.id, "url", "preview"],
    queryFn: () => apiGet<{ url: string; fileName: string; mimeType: string }>(`/documents/${previewDoc!.id}/url?mode=preview`),
    enabled: !!previewDoc,
  });

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">Dokümanlar (STEP / Çalışma Talimatı)</h2>
      {canWrite && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="w-40">
            <Select value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)}>
              {(Object.keys(DOC_TYPE_LABEL) as DocumentType[]).map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
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
      <Table headers={["Dosya", "Tür", "Boyut", "Tarih", "Yükleyen", ""]}>
        {list.data?.length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
              Doküman yok
            </td>
          </tr>
        )}
        {list.data?.map((d) => (
          <tr key={d.id} className="hover:bg-slate-50">
            <td className="px-4 py-3">{d.fileName}</td>
            <td className="px-4 py-3">{DOC_TYPE_LABEL[d.docType]}</td>
            <td className="px-4 py-3">{fmtSize(d.sizeBytes)}</td>
            <td className="px-4 py-3">{fmtDate(d.createdAt)}</td>
            <td className="px-4 py-3">{d.uploadedBy?.name ?? "—"}</td>
            <td className="px-4 py-3">
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  className="px-2 py-1"
                  title="Görüntüle"
                  onClick={() => setPreviewDoc(d)}
                >
                  <Eye className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1"
                  title="İndir"
                  onClick={() => download(d)}
                >
                  <Download className="h-4 w-4" />
                </Button>
                {canWrite && (
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-red-600"
                    title="Sil"
                    onClick={() => {
                      if (confirm("Doküman silinsin mi?")) remove.mutate(d.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Table>
      {canWrite && !list.data?.length && (
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-400">
          <Upload className="h-3 w-3" /> Dosya seçerek yükleyin.
        </p>
      )}

      <Modal
        open={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.fileName ?? ""}
        className="max-w-3xl"
      >
        {previewDoc && (
          <FilePreview
            fileUrl={previewUrl.data?.url ?? null}
            fileName={previewDoc.fileName}
            mimeType={previewDoc.mimeType}
            isLoading={previewUrl.isLoading}
          />
        )}
      </Modal>
    </div>
  );
}
