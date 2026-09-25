import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Trash2, Truck } from "lucide-react";
import { useState } from "react";
import { CrudPage } from "../components/crud-page";
import { Button, Input, Label, Modal, Select, Table } from "../components/ui";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useConfirm } from "../components/confirm-dialog";
import { useToast } from "../components/toast";

interface SupplierRow { id: string; name: string; contactName?: string | null; email?: string | null; phone?: string | null; }
interface MaterialOption { id: string; code: string; name: string; unit: string; }
interface SupplierMaterialRow { id: string; materialId: string; isPreferred: boolean; leadTimeDays: number | null; unitCost: string | null; material: MaterialOption; }
type SourceForm = { materialId: string; isPreferred?: boolean; leadTimeDays: string; unitCost: string; };
const emptySourceForm: SourceForm = { materialId: "", leadTimeDays: "", unitCost: "" };

export function SuppliersPage() {
  const { user } = useAuth();
  const canWrite = user?.role === "ADMIN" || user?.role === "PLANNER";
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierRow | null>(null);
  const [form, setForm] = useState<SourceForm>(emptySourceForm);
  const materials = useQuery({ queryKey: ["/materials"], queryFn: () => apiGet<MaterialOption[]>("/materials") });
  const sources = useQuery({
    queryKey: ["/suppliers", selectedSupplier?.id, "materials"],
    queryFn: () => apiGet<SupplierMaterialRow[]>(`/suppliers/${selectedSupplier!.id}/materials`),
    enabled: !!selectedSupplier,
  });
  const selectedSource = sources.data?.find((source) => source.materialId === form.materialId);
  const saveSource = useMutation({
    mutationFn: () => apiPost(`/suppliers/${selectedSupplier!.id}/materials`, {
      materialId: form.materialId,
      ...(form.isPreferred !== undefined ? { isPreferred: form.isPreferred } : {}),
      ...(form.leadTimeDays ? { leadTimeDays: Number(form.leadTimeDays) } : {}),
      ...(form.unitCost !== "" ? { unitCost: Number(form.unitCost) } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/suppliers", selectedSupplier?.id, "materials"] });
      setForm(emptySourceForm);
      toast("Malzeme kaynağı kaydedildi.", "success");
    },
    onError: () => toast("Kaynak ilişkisi kaydedilemedi.", "error"),
  });
  const removeSource = useMutation({
    mutationFn: (id: string) => apiDelete(`/suppliers/${selectedSupplier!.id}/materials/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/suppliers", selectedSupplier?.id, "materials"] });
      toast("Malzeme kaynağı kaldırıldı.", "success");
    },
    onError: () => toast("Kaynak ilişkisi kaldırılamadı.", "error"),
  });
  const closeSources = () => { setSelectedSupplier(null); setForm(emptySourceForm); };

  return <>
    <CrudPage<SupplierRow>
      title="Tedarikçiler" icon={Truck} endpoint="/suppliers" writeRoles={["ADMIN", "PLANNER"]}
      columns={[{ key: "name", label: "Ad" }, { key: "contactName", label: "İlgili Kişi" }, { key: "phone", label: "Telefon" }, { key: "email", label: "E-posta" }]}
      fields={[{ name: "name", label: "Ad", required: true }, { name: "contactName", label: "İlgili Kişi" }, { name: "email", label: "E-posta", type: "email" }, { name: "phone", label: "Telefon" }, { name: "address", label: "Adres" }, { name: "taxNo", label: "Vergi No" }, { name: "notes", label: "Notlar" }]}
      rowActions={(supplier) => <Button variant="ghost" className="px-2 py-1" title="Malzeme kaynakları" onClick={() => setSelectedSupplier(supplier)}><Link2 className="h-4 w-4" /></Button>}
    />
    <Modal open={!!selectedSupplier} title={`${selectedSupplier?.name ?? ""} — Malzeme Kaynakları`} onClose={closeSources}>
      <div className="space-y-5">
        {canWrite && <form onSubmit={(event) => { event.preventDefault(); saveSource.mutate(); }} className="rounded-lg border border-slate-200 p-4">
          <p className="mb-3 text-sm font-semibold text-slate-700">Malzeme ekle veya kaynak koşullarını güncelle</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label htmlFor="source-material">Malzeme</Label><Select id="source-material" required value={form.materialId} onChange={(event) => setForm({ ...emptySourceForm, materialId: event.target.value })}><option value="">Seçin…</option>{materials.data?.map((material) => <option key={material.id} value={material.id}>{material.code} — {material.name}</option>)}</Select></div>
            <div><Label htmlFor="source-lead-time">Termin süresi (gün)</Label><Input id="source-lead-time" type="number" min="1" value={form.leadTimeDays} onChange={(event) => setForm({ ...form, leadTimeDays: event.target.value })} /></div>
            <div><Label htmlFor="source-unit-cost">Birim maliyet</Label><Input id="source-unit-cost" type="number" min="0" step="0.0001" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} /></div>
            <label className="mt-6 flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={form.isPreferred ?? selectedSource?.isPreferred ?? false} onChange={(event) => setForm({ ...form, isPreferred: event.target.checked })} />Tercihli tedarikçi</label>
          </div>
          <div className="mt-3 flex justify-end"><Button type="submit" disabled={!form.materialId || saveSource.isPending}>{saveSource.isPending ? "Kaydediliyor…" : "Kaydet"}</Button></div>
        </form>}
        {sources.isLoading && <p className="text-sm text-slate-500">Kaynaklar yükleniyor…</p>}
        {sources.data && <Table headers={["Malzeme", "Termin", "Birim maliyet", "Durum", ...(canWrite ? [""] : [])]}>
          {sources.data.length === 0 && <tr><td colSpan={canWrite ? 5 : 4} className="px-4 py-8 text-center text-slate-400">Kaynak malzeme yok</td></tr>}
          {sources.data.map((source) => <tr key={source.id}>
            <td className="px-4 py-3"><span className="font-medium">{source.material.code}</span><span className="ml-2 text-slate-500">{source.material.name}</span></td><td className="px-4 py-3">{source.leadTimeDays ?? "—"}</td><td className="px-4 py-3">{source.unitCost ?? "—"}</td><td className="px-4 py-3">{source.isPreferred ? <span className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">Tercihli</span> : "Alternatif"}</td>
            {canWrite && <td className="px-4 py-3"><Button variant="ghost" className="px-2 py-1 text-red-600" title="Kaynağı kaldır" onClick={async () => { if (await confirm({ message: "Bu malzeme kaynağını kaldırmak istiyor musunuz?", danger: true })) removeSource.mutate(source.id); }}><Trash2 className="h-4 w-4" /></Button></td>}
          </tr>)}
        </Table>}
      </div>
    </Modal>
  </>;
}
