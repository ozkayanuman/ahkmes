import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Card, Input, Label, Modal, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";
import type { ProjectRow } from "./projects";

interface UserOption {
  id: string;
  name: string;
}
interface TimeEntryRow {
  id: string;
  hours: string;
  date: string;
  userId: string;
}
interface TaskRow {
  id: string;
  name: string;
  parentTaskId: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  startDate: string | null;
  endDate: string | null;
  assignee: { id: string; name: string } | null;
  timeEntries: TimeEntryRow[];
}
interface ProjectDetail extends ProjectRow {
  tasks: TaskRow[];
}
interface CostResult {
  laborCost: number;
  laborCostPartial: boolean;
  totalCost: number;
  note?: string;
}

const TASK_STATUS_LABEL: Record<TaskRow["status"], string> = {
  TODO: "Yapılacak",
  IN_PROGRESS: "Devam Ediyor",
  DONE: "Tamamlandı",
};

function TimeEntryModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [hours, setHours] = useState("");
  const [date, setDate] = useState("");

  const add = useMutation({
    mutationFn: () =>
      apiPost(`/project-tasks/${taskId}/time-entries`, { hours: Number(hours), ...(date ? { date } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/projects"] });
      onClose();
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Zaman kaydı eklenemedi", "error");
    },
  });

  return (
    <Modal open title="Zaman Kaydı Ekle" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="hours">Saat</Label>
          <Input id="hours" type="number" step="0.25" min="0" required value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="date">Tarih</Label>
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={add.isPending || !hours}>
            Kaydet
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [parentTaskId, setParentTaskId] = useState("");
  const [timeEntryTaskId, setTimeEntryTaskId] = useState<string | null>(null);

  const project = useQuery({
    queryKey: ["/projects", id],
    queryFn: () => apiGet<ProjectDetail>(`/projects/${id}`),
    enabled: !!id,
  });
  const cost = useQuery({
    queryKey: ["/projects", id, "cost"],
    queryFn: () => apiGet<CostResult>(`/projects/${id}/cost`),
    enabled: !!id,
  });
  const users = useQuery({
    queryKey: ["/projects/assignable-users"],
    queryFn: () => apiGet<UserOption[]>("/projects/assignable-users"),
    enabled: taskOpen,
  });

  const taskById = new Map((project.data?.tasks ?? []).map((t) => [t.id, t]));

  const createTask = useMutation({
    mutationFn: () =>
      apiPost(`/projects/${id}/tasks`, {
        name: taskName,
        ...(assigneeId ? { assigneeId } : {}),
        ...(parentTaskId ? { parentTaskId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/projects", id] });
      setTaskOpen(false);
      setTaskName("");
      setAssigneeId("");
      setParentTaskId("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Görev oluşturulamadı", "error");
    },
  });

  if (project.isLoading) return <p className="text-slate-500">Yükleniyor…</p>;
  if (!project.data) return null;

  return (
    <div>
      <Link to="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Projeler
      </Link>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">
          {project.data.code} — {project.data.name}
        </h1>
        {canWrite && (
          <Button onClick={() => setTaskOpen(true)}>
            <Plus className="h-4 w-4" /> Yeni Görev
          </Button>
        )}
      </div>

      <Card className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Maliyet</h2>
        {cost.data ? (
          <div className="text-sm">
            <p>
              İşçilik Maliyeti: <span className="font-semibold">{cost.data.laborCost.toFixed(2)}</span>
            </p>
            <p>
              Toplam: <span className="font-semibold">{cost.data.totalCost.toFixed(2)}</span>
            </p>
            {cost.data.note && <p className="mt-1 text-amber-600">{cost.data.note}</p>}
          </div>
        ) : (
          <p className="text-slate-400">Yükleniyor…</p>
        )}
      </Card>

      <Table headers={["Görev", "Üst Görev", "Atanan", "Durum", "Başlangıç", "Bitiş", "Toplam Saat", ""]}>
        {project.data.tasks.length === 0 && (
          <tr>
            <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
              Görev yok
            </td>
          </tr>
        )}
        {project.data.tasks.map((t) => {
          const totalHours = t.timeEntries.reduce((sum, e) => sum + Number(e.hours), 0);
          const parent = t.parentTaskId ? taskById.get(t.parentTaskId) : undefined;
          return (
            <tr key={t.id}>
              <td className="px-4 py-3 font-medium">{t.name}</td>
              <td className="px-4 py-3">{parent?.name ?? "—"}</td>
              <td className="px-4 py-3">{t.assignee?.name ?? "—"}</td>
              <td className="px-4 py-3">{TASK_STATUS_LABEL[t.status]}</td>
              <td className="px-4 py-3">{t.startDate ? fmtDate(t.startDate) : "—"}</td>
              <td className="px-4 py-3">{t.endDate ? fmtDate(t.endDate) : "—"}</td>
              <td className="px-4 py-3">{totalHours || "—"}</td>
              <td className="px-4 py-3">
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setTimeEntryTaskId(t.id)}>
                  <Clock className="h-4 w-4" /> Saat Ekle
                </Button>
              </td>
            </tr>
          );
        })}
      </Table>

      <Modal open={taskOpen} title="Yeni Görev" onClose={() => setTaskOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createTask.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="taskName">Görev Adı</Label>
            <Input id="taskName" required value={taskName} onChange={(e) => setTaskName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="assigneeId">Atanan (opsiyonel)</Label>
            <Select id="assigneeId" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Seçin…</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="parentTaskId">Üst Görev (opsiyonel)</Label>
            <Select id="parentTaskId" value={parentTaskId} onChange={(e) => setParentTaskId(e.target.value)}>
              <option value="">Seçin…</option>
              {project.data.tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setTaskOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={createTask.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>

      {timeEntryTaskId && (
        <TimeEntryModal
          taskId={timeEntryTaskId}
          onClose={() => {
            setTimeEntryTaskId(null);
            qc.invalidateQueries({ queryKey: ["/projects", id] });
            qc.invalidateQueries({ queryKey: ["/projects", id, "cost"] });
          }}
        />
      )}
    </div>
  );
}
