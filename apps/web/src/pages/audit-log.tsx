import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useState } from "react";
import { apiGet } from "../lib/api";
import { Modal, Select, Table } from "../components/ui";

interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE";
  before: unknown;
  after: unknown;
  createdAt: string;
  user: { id: string; name: string };
}

const ACTION_LABEL: Record<AuditEntry["action"], string> = {
  CREATE: "Oluşturuldu",
  UPDATE: "Güncellendi",
  DELETE: "Silindi",
  STATUS_CHANGE: "Durum Değişti",
};

const ACTION_CLS: Record<AuditEntry["action"], string> = {
  CREATE: "bg-green-100 text-green-700",
  UPDATE: "bg-blue-100 text-blue-700",
  DELETE: "bg-red-100 text-red-700",
  STATUS_CHANGE: "bg-amber-100 text-amber-700",
};

/** Denetim izi (audit trail) — kim/ne zaman/neyi değiştirdi. Regülasyon gerektiren
 * sektörlerde (otomotiv/havacılık) standart bir MES/ERP özelliğidir; veri zaten
 * AuditInterceptor ile toplanıyordu, bu sayfa onu görünür kılar. Sadece ADMIN görür. */
export function AuditLogPage() {
  const [entity, setEntity] = useState("");
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  const entities = useQuery({
    queryKey: ["/audit-log/entities"],
    queryFn: () => apiGet<string[]>("/audit-log/entities"),
  });
  const query = useQuery({
    queryKey: ["/audit-log", entity],
    queryFn: () => apiGet<AuditEntry[]>(`/audit-log${entity ? `?entity=${entity}` : ""}`),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <History className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold">Denetim İzi</h1>
        </div>
        <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="max-w-[220px]">
          <option value="">Tüm Varlıklar</option>
          {(entities.data ?? []).map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </Select>
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {query.error && <p className="text-red-600">Kayıtlar alınamadı.</p>}

      {query.data && (
        <Table headers={["Tarih", "Kullanıcı", "Varlık", "Kayıt No", "Aksiyon", ""]}>
          {query.data.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center">
                <History className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                <span className="text-sm text-slate-400">Kayıt yok</span>
              </td>
            </tr>
          )}
          {query.data.map((e) => (
            <tr key={e.id} className="hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-3">{new Date(e.createdAt).toLocaleString("tr-TR")}</td>
              <td className="px-4 py-3">{e.user?.name ?? "—"}</td>
              <td className="px-4 py-3 font-mono text-xs text-slate-500">{e.entity}</td>
              <td className="max-w-[160px] truncate px-4 py-3 font-mono text-xs text-slate-500">{e.entityId}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_CLS[e.action]}`}>
                  {ACTION_LABEL[e.action]}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => setDetail(e)} className="text-sm font-medium text-brand-700 hover:underline">
                  Detay
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal
        open={detail !== null}
        title={detail ? `${detail.entity} — ${ACTION_LABEL[detail.action]}` : "Detay"}
        onClose={() => setDetail(null)}
        className="max-w-2xl"
      >
        {detail && (
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <h3 className="mb-1 font-semibold text-slate-500">Önceki Değer</h3>
              <pre className="max-h-96 overflow-auto rounded-md bg-slate-50 p-3">
                {detail.before ? JSON.stringify(detail.before, null, 2) : "—"}
              </pre>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-slate-500">Yeni Değer</h3>
              <pre className="max-h-96 overflow-auto rounded-md bg-slate-50 p-3">
                {detail.after ? JSON.stringify(detail.after, null, 2) : "—"}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
