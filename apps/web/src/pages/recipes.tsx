import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPatch, apiPost, apiUpload } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
import { InstructionEditor } from "../components/instruction-editor";
import { useToast } from "../components/toast";

interface PartOption {
  id: string;
  partNo: string;
  name: string;
}
interface RecipeStepRow {
  id: string;
  seq: number;
  name: string;
  parameterName: string | null;
  parameterValue: string | null;
  unit: string | null;
  standardMinutes: number | null;
  idealCycleTimeSec: number | null;
  instructionHtml: string | null;
}
interface RecipeRow {
  id: string;
  revision: string;
  isActive: boolean;
  notes: string | null;
  part: { id: string; partNo: string; name: string };
  steps: RecipeStepRow[];
}
interface StepInput {
  id?: string;
  seq: number;
  name: string;
  parameterName: string;
  parameterValue: string;
  unit: string;
  standardMinutes: string;
  idealCycleTimeSec: string;
  instructionHtml: string;
}

const emptyStep = (seq: number): StepInput => ({
  seq,
  name: "",
  parameterName: "",
  parameterValue: "",
  unit: "",
  standardMinutes: "",
  idealCycleTimeSec: "",
  instructionHtml: "",
});

export function RecipesPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [partId, setPartId] = useState("");
  const [partLabel, setPartLabel] = useState("");
  const [revision, setRevision] = useState("A");
  const [notes, setNotes] = useState("");
  const [steps, setSteps] = useState<StepInput[]>([emptyStep(1)]);

  const recipes = useQuery({
    queryKey: ["/recipes"],
    queryFn: () => apiGet<RecipeRow[]>("/recipes"),
  });
  const parts = useQuery({
    queryKey: ["/parts"],
    queryFn: () => apiGet<PartOption[]>("/parts"),
    enabled: open && !editingId,
  });

  const save = useMutation({
    mutationFn: () => {
      const stepsPayload = steps.map((s) => ({
        ...(s.id ? { id: s.id } : {}),
        seq: s.seq,
        name: s.name,
        ...(s.parameterName ? { parameterName: s.parameterName } : {}),
        ...(s.parameterValue ? { parameterValue: s.parameterValue } : {}),
        ...(s.unit ? { unit: s.unit } : {}),
        ...(s.standardMinutes ? { standardMinutes: Number(s.standardMinutes) } : {}),
        ...(s.idealCycleTimeSec ? { idealCycleTimeSec: Number(s.idealCycleTimeSec) } : {}),
        ...(s.instructionHtml ? { instructionHtml: s.instructionHtml } : {}),
      }));
      if (editingId) {
        return apiPatch(`/recipes/${editingId}`, { ...(notes ? { notes } : {}), steps: stepsPayload });
      }
      return apiPost("/recipes", { partId, revision, ...(notes ? { notes } : {}), steps: stepsPayload });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/recipes"] });
      setOpen(false);
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Reçete kaydedilemedi", "error");
    },
  });

  function openCreate() {
    setEditingId(null);
    setPartId("");
    setPartLabel("");
    setRevision("A");
    setNotes("");
    setSteps([emptyStep(1)]);
    setOpen(true);
  }

  function openEdit(row: RecipeRow) {
    setEditingId(row.id);
    setPartId(row.part.id);
    setPartLabel(`${row.part.partNo} — ${row.part.name}`);
    setRevision(row.revision);
    setNotes(row.notes ?? "");
    setSteps(
      row.steps.map((s) => ({
        id: s.id,
        seq: s.seq,
        name: s.name,
        parameterName: s.parameterName ?? "",
        parameterValue: s.parameterValue ?? "",
        unit: s.unit ?? "",
        standardMinutes: s.standardMinutes != null ? String(s.standardMinutes) : "",
        idealCycleTimeSec: s.idealCycleTimeSec != null ? String(s.idealCycleTimeSec) : "",
        instructionHtml: s.instructionHtml ?? "",
      })),
    );
    setOpen(true);
  }

  function updateStep(idx: number, patch: Partial<StepInput>) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Süreç Reçeteleri</h1>
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Yeni Reçete
          </Button>
        )}
      </div>

      {recipes.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["Parça", "Revizyon", "Durum", "Adım Sayısı", "Notlar", ""]}>
        {(recipes.data ?? []).length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(recipes.data ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">
              {row.part.partNo} — {row.part.name}
            </td>
            <td className="px-4 py-3">{row.revision}</td>
            <td className="px-4 py-3">
              {row.isActive ? (
                <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  Aktif
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                  Pasif
                </span>
              )}
            </td>
            <td className="px-4 py-3">{row.steps.length}</td>
            <td className="px-4 py-3 text-slate-500">{row.notes ?? "—"}</td>
            <td className="px-4 py-3">
              {canWrite && (
                <Button variant="ghost" className="px-2 py-1" title="Düzenle" onClick={() => openEdit(row)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={open} title={editingId ? "Reçete Düzenle" : "Yeni Reçete"} onClose={() => setOpen(false)} className="max-w-4xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          {editingId ? (
            <p className="text-sm text-slate-600">
              <span className="font-medium">{partLabel}</span> — Revizyon {revision}
              <span className="ml-2 text-xs text-slate-400">(parça/revizyon değiştirilemez — yeni revizyon için "Yeni Reçete" kullanın)</span>
            </p>
          ) : (
            <>
              <div>
                <Label htmlFor="partId">Parça</Label>
                <Select id="partId" required value={partId} onChange={(e) => setPartId(e.target.value)}>
                  <option value="">Seçin…</option>
                  {parts.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partNo} — {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="revision">Revizyon</Label>
                <Input id="revision" required value={revision} onChange={(e) => setRevision(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <Label htmlFor="notes">Notlar</Label>
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Süreç Adımları</Label>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSteps((prev) => [...prev, emptyStep(prev.length + 1)])}
              >
                <Plus className="h-3.5 w-3.5" /> Adım Ekle
              </Button>
            </div>
            <div className="space-y-4">
              {steps.map((s, idx) => (
                <div key={idx} className="rounded-lg border border-slate-100 p-3">
                  <div className="grid grid-cols-[2rem_1fr_1fr_1fr_5rem_7rem_7rem_2rem] items-center gap-2">
                    <span className="text-sm text-slate-500">{s.seq}</span>
                    <Input placeholder="Adım adı" required value={s.name} onChange={(e) => updateStep(idx, { name: e.target.value })} />
                    <Input
                      placeholder="Parametre"
                      value={s.parameterName}
                      onChange={(e) => updateStep(idx, { parameterName: e.target.value })}
                    />
                    <Input
                      placeholder="Değer"
                      value={s.parameterValue}
                      onChange={(e) => updateStep(idx, { parameterValue: e.target.value })}
                    />
                    <Input placeholder="Birim" value={s.unit} onChange={(e) => updateStep(idx, { unit: e.target.value })} />
                    <Input
                      type="number"
                      min="0"
                      placeholder="Standart süre (dk)"
                      value={s.standardMinutes}
                      onChange={(e) => updateStep(idx, { standardMinutes: e.target.value })}
                    />
                    <Input
                      type="number"
                      min="0.000001"
                      step="any"
                      placeholder="Ideal cycle (sn/adet)"
                      value={s.idealCycleTimeSec}
                      onChange={(e) => updateStep(idx, { idealCycleTimeSec: e.target.value })}
                    />
                    <button
                      type="button"
                      className="text-slate-400 hover:text-red-600"
                      onClick={() => setSteps((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={steps.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2">
                    <Label>İş Talimatı</Label>
                    <InstructionEditor
                      content={s.instructionHtml}
                      onChange={(html) => updateStep(idx, { instructionHtml: html })}
                      onUploadImage={
                        s.id
                          ? async (file: File) =>
                              apiUpload<{ id: string }>(
                                `/documents?entityType=recipe-step&entityId=${s.id}&docType=WORK_INSTRUCTION`,
                                file,
                              )
                          : undefined
                      }
                    />
                    {!s.id && (
                      <p className="mt-1 text-xs text-slate-400">Resim eklemek için önce adımı kaydedin.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
