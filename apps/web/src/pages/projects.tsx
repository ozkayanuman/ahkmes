import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Input, Label, Modal, Table } from "../components/ui";
import { useToast } from "../components/toast";

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  status: "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<ProjectRow["status"], string> = {
  PLANNED: "Planlandı",
  ACTIVE: "Aktif",
  ON_HOLD: "Beklemede",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
};

export function ProjectsPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const projects = useQuery({ queryKey: ["/projects"], queryFn: () => apiGet<ProjectRow[]>("/projects") });

  const create = useMutation({
    mutationFn: () =>
      apiPost("/projects", {
        code,
        name,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/projects"] });
      setOpen(false);
      setCode("");
      setName("");
      setStartDate("");
      setEndDate("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Proje oluşturulamadı", "error");
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Projeler</h1>
        {canWrite && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Yeni Proje
          </Button>
        )}
      </div>

      {projects.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["Kod", "Ad", "Durum", "Başlangıç", "Bitiş", ""]}>
        {(projects.data ?? []).length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(projects.data ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.code}</td>
            <td className="px-4 py-3">{row.name}</td>
            <td className="px-4 py-3">{STATUS_LABEL[row.status]}</td>
            <td className="px-4 py-3">{row.startDate ? fmtDate(row.startDate) : "—"}</td>
            <td className="px-4 py-3">{row.endDate ? fmtDate(row.endDate) : "—"}</td>
            <td className="px-4 py-3 text-right">
              <Link to={`/projects/${row.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                Detay
              </Link>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={open} title="Yeni Proje" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="code">Proje Kodu</Label>
            <Input id="code" required value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="name">Ad</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="startDate">Başlangıç Tarihi</Label>
            <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="endDate">Bitiş Tarihi</Label>
            <Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
