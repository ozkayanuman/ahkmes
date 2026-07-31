import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

interface CustomerOption {
  id: string;
  name: string;
}
interface TicketRow {
  id: string;
  subject: string;
  description: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  resolutionNote: string | null;
  resolvedAt: string | null;
  customer: { id: string; name: string };
  createdBy: { id: string; name: string };
  createdAt: string;
}

const PRIORITY_LABEL: Record<TicketRow["priority"], string> = { LOW: "Düşük", MEDIUM: "Orta", HIGH: "Yüksek" };
const STATUS_LABEL: Record<TicketRow["status"], string> = {
  OPEN: "Açık",
  IN_PROGRESS: "Devam Ediyor",
  RESOLVED: "Çözümlendi",
  CLOSED: "Kapalı",
};

function NewTicketModal({ customers, onClose }: { customers: CustomerOption[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [customerId, setCustomerId] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketRow["priority"]>("MEDIUM");

  const create = useMutation({
    mutationFn: () =>
      apiPost("/service-tickets", { customerId, subject, ...(description ? { description } : {}), priority }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/service-tickets"] });
      onClose();
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Talep oluşturulamadı", "error");
    },
  });

  return (
    <Modal open title="Yeni Servis Talebi" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="customerId">Müşteri</Label>
          <Select id="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Seçin…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="subject">Konu</Label>
          <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="description">Açıklama</Label>
          <Textarea id="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="priority">Öncelik</Label>
          <Select id="priority" value={priority} onChange={(e) => setPriority(e.target.value as TicketRow["priority"])}>
            <option value="LOW">Düşük</option>
            <option value="MEDIUM">Orta</option>
            <option value="HIGH">Yüksek</option>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={!customerId || !subject.trim() || create.isPending} onClick={() => create.mutate()}>
            Kaydet
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TicketDetailModal({ ticket, onClose }: { ticket: TicketRow; onClose: () => void }) {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "SALES"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<TicketRow["status"]>(ticket.status);
  const [note, setNote] = useState(ticket.resolutionNote ?? "");

  const needsNote = status === "RESOLVED" && !ticket.resolutionNote;

  const update = useMutation({
    mutationFn: () => apiPatch(`/service-tickets/${ticket.id}/resolve`, { status, resolutionNote: note || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/service-tickets"] });
      onClose();
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Güncellenemedi", "error");
    },
  });

  return (
    <Modal open title={`${ticket.customer.name} — ${ticket.subject}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        {ticket.description && <p className="text-slate-600">{ticket.description}</p>}
        <div className="text-xs text-slate-400">
          {ticket.createdBy.name} · {fmtDate(ticket.createdAt)} · {PRIORITY_LABEL[ticket.priority]}
        </div>

        {canWrite ? (
          <>
            <div>
              <Label htmlFor="status">Durum</Label>
              <Select id="status" value={status} onChange={(e) => setStatus(e.target.value as TicketRow["status"])}>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="note">Çözüm Açıklaması {needsNote && "(zorunlu)"}</Label>
              <Textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button disabled={(needsNote && !note.trim()) || update.isPending} onClick={() => update.mutate()}>
                Güncelle
              </Button>
            </div>
          </>
        ) : (
          <div>
            Durum: <span className="font-medium">{STATUS_LABEL[ticket.status]}</span>
            {ticket.resolutionNote && <p className="mt-2 text-slate-700">{ticket.resolutionNote}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ServiceTicketsPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "SALES"].includes(user.role);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TicketRow | null>(null);

  const tickets = useQuery({ queryKey: ["/service-tickets"], queryFn: () => apiGet<TicketRow[]>("/service-tickets") });
  const customers = useQuery({
    queryKey: ["/customers"],
    queryFn: () => apiGet<CustomerOption[]>("/customers"),
    enabled: open,
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <LifeBuoy className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold">Servis Talepleri</h1>
        </div>
        {canWrite && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Yeni Talep
          </Button>
        )}
      </div>

      {tickets.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["Müşteri", "Konu", "Öncelik", "Durum", "Oluşturma", ""]}>
        {(tickets.data ?? []).length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(tickets.data ?? []).map((t) => (
          <tr key={t.id}>
            <td className="px-4 py-3 font-medium">{t.customer.name}</td>
            <td className="px-4 py-3">{t.subject}</td>
            <td className="px-4 py-3">{PRIORITY_LABEL[t.priority]}</td>
            <td className="px-4 py-3">{STATUS_LABEL[t.status]}</td>
            <td className="px-4 py-3">{fmtDate(t.createdAt)}</td>
            <td className="px-4 py-3 text-right">
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setSelected(t)}>
                Detay
              </Button>
            </td>
          </tr>
        ))}
      </Table>

      {open && <NewTicketModal customers={customers.data ?? []} onClose={() => setOpen(false)} />}
      {selected && <TicketDetailModal ticket={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
