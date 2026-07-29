import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Link2 } from "lucide-react";
import { useState } from "react";
import { clsx } from "clsx";
import { CrudPage } from "../components/crud-page";
import { Button, Label, Modal, Select } from "../components/ui";
import { useConfirm } from "../components/confirm-dialog";
import { useToast } from "../components/toast";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";

interface MachineRow {
  id: string;
  name: string;
  model: string;
  controller?: string | null;
  isActive: boolean;
  activeWorkOrderId?: string | null;
  activeWorkOrder?: { id: string; woNo: string; status: string } | null;
  lastEventAt?: string | null;
  lastStatus?: string | null;
}

interface WorkOrderOption {
  id: string;
  woNo: string;
  status: string;
  machine?: { id: string } | null;
}

const MACHINE_STATUS: Record<string, { label: string; cls: string }> = {
  CYCLE_START: { label: "Çalışıyor", cls: "bg-blue-100 text-blue-700" },
  PART_COMPLETE: { label: "Çalışıyor", cls: "bg-blue-100 text-blue-700" },
  CYCLE_END: { label: "Boşta", cls: "bg-slate-100 text-slate-700" },
  IDLE: { label: "Boşta", cls: "bg-slate-100 text-slate-700" },
  ALARM: { label: "Alarm", cls: "bg-red-100 text-red-700" },
};

function machineStatus(row: MachineRow) {
  if (!row.lastStatus || !row.lastEventAt) return { label: "Bağlı değil", cls: "bg-slate-100 text-slate-400" };
  return MACHINE_STATUS[row.lastStatus] ?? { label: row.lastStatus, cls: "bg-slate-100 text-slate-700" };
}

/** Yeni üretilen connector anahtarını gösterir (bir daha gösterilmez) — kopyala
 * butonuyla; native prompt() yerine. */
function ConnectorKeyModal({ machineName, apiKey, onClose }: { machineName: string; apiKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal open title={`${machineName} — Connector Anahtarı`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Bu değer bir daha gösterilmeyecek — connector <code>.env</code> dosyasına (<code>MACHINE_KEY</code>)
          kopyalayın.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-md bg-slate-100 px-3 py-2 text-sm">{apiKey}</code>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(apiKey);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Kopyalandı" : "Kopyala"}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>Kapat</Button>
        </div>
      </div>
    </Modal>
  );
}

function AssignWorkOrderModal({
  machine,
  onClose,
}: {
  machine: MachineRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [workOrderId, setWorkOrderId] = useState(machine.activeWorkOrderId ?? "");
  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WorkOrderOption[]>("/work-orders"),
  });
  const options = (workOrders.data ?? []).filter(
    (wo) =>
      (wo.machine?.id === machine.id || !wo.machine) &&
      wo.status !== "COMPLETED" &&
      wo.status !== "CANCELLED",
  );

  const assign = useMutation({
    mutationFn: () =>
      apiPatch(`/machines/${machine.id}/active-work-order`, { workOrderId: workOrderId || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/machines"] });
      onClose();
    },
    onError: () => toast("Atama başarısız", "error"),
  });

  return (
    <Modal open title={`${machine.name} — Aktif İş Emri`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="wo">İş Emri</Label>
          <Select id="wo" value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
            <option value="">Atanmadı</option>
            {options.map((wo) => (
              <option key={wo.id} value={wo.id}>
                {wo.woNo}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={assign.isPending} onClick={() => assign.mutate()}>
            Kaydet
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function MachinesPage() {
  const { user } = useAuth();
  const canManage = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const canAssign = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [assignFor, setAssignFor] = useState<MachineRow | null>(null);
  const [newKeyFor, setNewKeyFor] = useState<{ name: string; key: string } | null>(null);

  useInvalidateOn(["machine.updated", "machine.alarm"], ["/machines"]);

  const generateKey = useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => apiPost<{ key: string }>(`/machines/${id}/connector-key`, {}),
    onSuccess: (res, { name }) => {
      qc.invalidateQueries({ queryKey: ["/machines"] });
      setNewKeyFor({ name, key: res.key });
    },
    onError: () => toast("Anahtar üretilemedi", "error"),
  });

  return (
    <>
      <CrudPage<MachineRow>
        title="Tezgahlar"
        endpoint="/machines"
        writeRoles={["ADMIN"]}
        searchable={false}
        columns={[
          { key: "name", label: "Ad" },
          { key: "model", label: "Model" },
          { key: "controller", label: "Kontrol Ünitesi" },
          { key: "isActive", label: "Durum", render: (r) => (r.isActive ? "Aktif" : "Pasif") },
          {
            key: "liveStatus",
            label: "Canlı Durum",
            render: (r) => {
              const s = machineStatus(r);
              return (
                <div className="flex flex-col gap-1">
                  <span
                    className={clsx("inline-flex w-fit rounded-full px-2.5 py-0.5 text-xs font-medium", s.cls)}
                  >
                    {s.label}
                  </span>
                  {r.lastEventAt && (
                    <span className="text-xs text-slate-400">{fmtDate(r.lastEventAt)}</span>
                  )}
                </div>
              );
            },
          },
          {
            key: "activeWorkOrder",
            label: "Aktif İş Emri",
            render: (r) => r.activeWorkOrder?.woNo ?? "—",
          },
        ]}
        fields={[
          { name: "name", label: "Ad", required: true },
          { name: "model", label: "Model", required: true },
          { name: "controller", label: "Kontrol Ünitesi (örn. Fanuc 0i-MF)" },
          { name: "isActive", label: "Aktif", type: "checkbox" },
        ]}
        rowActions={(row) => (
          <div className="flex gap-1">
            {canAssign && (
              <Button
                variant="ghost"
                className="px-2 py-1"
                title="Aktif İş Emri Ata"
                onClick={() => setAssignFor(row)}
              >
                <Link2 className="h-4 w-4" />
              </Button>
            )}
            {canManage && (
              <Button
                variant="ghost"
                className="px-2 py-1"
                title="Connector Anahtarı Oluştur"
                onClick={async () => {
                  if (
                    await confirm({
                      message: `${row.name} için yeni bir connector anahtarı üretilsin mi? Eski anahtar geçersiz olur.`,
                      danger: true,
                    })
                  )
                    generateKey.mutate({ id: row.id, name: row.name });
                }}
              >
                <KeyRound className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      />
      {assignFor && <AssignWorkOrderModal machine={assignFor} onClose={() => setAssignFor(null)} />}
      {newKeyFor && (
        <ConnectorKeyModal machineName={newKeyFor.name} apiKey={newKeyFor.key} onClose={() => setNewKeyFor(null)} />
      )}
    </>
  );
}
