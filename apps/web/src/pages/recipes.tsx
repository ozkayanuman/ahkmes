import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
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
  seq: number;
  name: string;
  parameterName: string;
  parameterValue: string;
  unit: string;
}

const emptyStep = (seq: number): StepInput => ({ seq, name: "", parameterName: "", parameterValue: "", unit: "" });

export function RecipesPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [partId, setPartId] = useState("");
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
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost("/recipes", {
        partId,
        revision,
        ...(notes ? { notes } : {}),
        steps: steps.map((s) => ({
          seq: s.seq,
          name: s.name,
          ...(s.parameterName ? { parameterName: s.parameterName } : {}),
          ...(s.parameterValue ? { parameterValue: s.parameterValue } : {}),
          ...(s.unit ? { unit: s.unit } : {}),
        })),
      }),
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
    setPartId("");
    setRevision("A");
    setNotes("");
    setSteps([emptyStep(1)]);
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
      <Table headers={["Parça", "Revizyon", "Durum", "Adım Sayısı", "Notlar"]}>
        {(recipes.data ?? []).length === 0 && (
          <tr>
            <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
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
          </tr>
        ))}
      </Table>

      <Modal open={open} title="Yeni Reçete" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
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
            <div className="space-y-2">
              {steps.map((s, idx) => (
                <div key={idx} className="grid grid-cols-[2rem_1fr_1fr_1fr_5rem_2rem] items-center gap-2">
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
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600"
                    onClick={() => setSteps((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={steps.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
