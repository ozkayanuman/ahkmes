import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

interface MachineOption {
  id: string;
  name: string;
}
interface AlarmDefinitionRow {
  id: string;
  code: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  machine: { id: string; name: string } | null;
}
interface ActiveAlarmRow {
  id: string;
  message: string | null;
  occurredAt: string;
  machine: { id: string; name: string };
}
interface ParetoRow {
  message: string;
  count: number;
}

const SEVERITY_STYLES: Record<AlarmDefinitionRow["severity"], string> = {
  LOW: "bg-slate-100 text-slate-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  HIGH: "bg-orange-100 text-orange-700",
  CRITICAL: "bg-red-100 text-red-700",
};

export function AlarmsPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const canAck = !!user;
  const qc = useQueryClient();
  const toast = useToast();
  const [defOpen, setDefOpen] = useState(false);
  const [ackTarget, setAckTarget] = useState<ActiveAlarmRow | null>(null);
  const [ackNote, setAckNote] = useState("");

  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<AlarmDefinitionRow["severity"]>("MEDIUM");
  const [machineId, setMachineId] = useState("");

  const definitions = useQuery({
    queryKey: ["/alarms/definitions"],
    queryFn: () => apiGet<AlarmDefinitionRow[]>("/alarms/definitions"),
  });
  const active = useQuery({
    queryKey: ["/alarms/active"],
    queryFn: () => apiGet<ActiveAlarmRow[]>("/alarms/active"),
    refetchInterval: 15000,
  });
  const pareto = useQuery({
    queryKey: ["/alarms/pareto"],
    queryFn: () => apiGet<ParetoRow[]>("/alarms/pareto"),
  });
  const machines = useQuery({
    queryKey: ["/machines"],
    queryFn: () => apiGet<MachineOption[]>("/machines"),
    enabled: defOpen,
  });

  const createDefinition = useMutation({
    mutationFn: () =>
      apiPost("/alarms/definitions", {
        code,
        description,
        severity,
        ...(machineId ? { machineId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/alarms/definitions"] });
      setDefOpen(false);
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Alarm tanımı kaydedilemedi", "error");
    },
  });

  const acknowledge = useMutation({
    mutationFn: () => apiPost(`/alarms/${ackTarget!.id}/acknowledge`, { ...(ackNote ? { note: ackNote } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/alarms/active"] });
      setAckTarget(null);
      setAckNote("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Alarm onaylanamadı", "error");
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">Alarm Yönetimi</h1>
          {canWrite && (
            <Button
              onClick={() => {
                setCode("");
                setDescription("");
                setSeverity("MEDIUM");
                setMachineId("");
                setDefOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Yeni Alarm Kodu
            </Button>
          )}
        </div>

        <h2 className="mb-2 text-lg font-semibold">Aktif (Onaylanmamış) Alarmlar</h2>
        <Table headers={["Makine", "Mesaj", "Zaman", ""]}>
          {(active.data ?? []).length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                Aktif alarm yok
              </td>
            </tr>
          )}
          {(active.data ?? []).map((a) => (
            <tr key={a.id}>
              <td className="px-4 py-3 font-medium">{a.machine.name}</td>
              <td className="px-4 py-3">{a.message ?? "—"}</td>
              <td className="px-4 py-3">{fmtDate(a.occurredAt)}</td>
              <td className="px-4 py-3">
                {canAck && (
                  <button
                    className="text-brand-700 hover:underline"
                    onClick={() => {
                      setAckTarget(a);
                      setAckNote("");
                    }}
                  >
                    Onayla
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Alarm Kod Kataloğu</h2>
        <Table headers={["Kod", "Açıklama", "Önem", "Makine"]}>
          {(definitions.data ?? []).length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                Kayıt yok
              </td>
            </tr>
          )}
          {(definitions.data ?? []).map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-3 font-medium">{d.code}</td>
              <td className="px-4 py-3">{d.description}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${SEVERITY_STYLES[d.severity]}`}>
                  {d.severity}
                </span>
              </td>
              <td className="px-4 py-3">{d.machine?.name ?? "Genel"}</td>
            </tr>
          ))}
        </Table>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Frekans (Pareto)</h2>
        <Table headers={["Alarm Mesajı", "Tekrar Sayısı"]}>
          {(pareto.data ?? []).length === 0 && (
            <tr>
              <td colSpan={2} className="px-4 py-8 text-center text-slate-400">
                Veri yok
              </td>
            </tr>
          )}
          {(pareto.data ?? []).map((p) => (
            <tr key={p.message}>
              <td className="px-4 py-3">{p.message}</td>
              <td className="px-4 py-3 font-medium">{p.count}</td>
            </tr>
          ))}
        </Table>
      </div>

      <Modal open={defOpen} title="Yeni Alarm Kodu" onClose={() => setDefOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createDefinition.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="code">Kod</Label>
            <Input id="code" required value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="description">Açıklama</Label>
            <Textarea id="description" required rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="severity">Önem Derecesi</Label>
            <Select id="severity" value={severity} onChange={(e) => setSeverity(e.target.value as AlarmDefinitionRow["severity"])}>
              <option value="LOW">Düşük</option>
              <option value="MEDIUM">Orta</option>
              <option value="HIGH">Yüksek</option>
              <option value="CRITICAL">Kritik</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="machineId">Makine (opsiyonel)</Label>
            <Select id="machineId" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">Genel</option>
              {machines.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDefOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={createDefinition.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!ackTarget} title="Alarmı Onayla" onClose={() => setAckTarget(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            acknowledge.mutate();
          }}
          className="space-y-4"
        >
          <p className="text-sm text-slate-600">
            {ackTarget?.machine.name}: {ackTarget?.message}
          </p>
          <div>
            <Label htmlFor="ackNote">Not (opsiyonel)</Label>
            <Textarea id="ackNote" rows={2} value={ackNote} onChange={(e) => setAckNote(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAckTarget(null)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={acknowledge.isPending}>
              Onayla
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
