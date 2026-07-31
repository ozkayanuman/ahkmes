import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Target, Users } from "lucide-react";
import { useState } from "react";
import { CrudPage } from "../components/crud-page";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Input, Label, Modal, Select, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

interface CustomerRow {
  id: string;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  taxNo?: string | null;
}

interface CustomerNoteRow {
  id: string;
  note: string;
  createdAt: string;
  author: { id: string; name: string };
}

function CustomerNotesModal({ customer, onClose }: { customer: CustomerRow; onClose: () => void }) {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "SALES"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");

  const notes = useQuery({
    queryKey: ["/customers", customer.id, "notes"],
    queryFn: () => apiGet<CustomerNoteRow[]>(`/customers/${customer.id}/notes`),
  });

  const add = useMutation({
    mutationFn: () => apiPost(`/customers/${customer.id}/notes`, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/customers", customer.id, "notes"] });
      setNote("");
    },
    onError: () => toast("Not eklenemedi", "error"),
  });

  return (
    <Modal open title={`${customer.name} — Aktivite Notları`} onClose={onClose}>
      <div className="mb-4 max-h-80 space-y-3 overflow-y-auto">
        {notes.isLoading && <p className="text-sm text-slate-500">Yükleniyor…</p>}
        {notes.data?.length === 0 && <p className="text-sm text-slate-400">Henüz not yok.</p>}
        {notes.data?.map((n) => (
          <div key={n.id} className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="text-slate-700">{n.note}</div>
            <div className="mt-1 text-xs text-slate-400">
              {n.author.name} · {fmtDate(n.createdAt)}
            </div>
          </div>
        ))}
      </div>
      {canWrite && (
        <div className="space-y-2">
          <Textarea
            rows={3}
            placeholder="Yeni not… (örn. müşteri aradı, fiyat talep etti)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex justify-end">
            <Button disabled={!note.trim() || add.isPending} onClick={() => add.mutate()}>
              Not Ekle
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface OpportunityRow {
  id: string;
  title: string;
  stage: "NEW" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST";
  estimatedValue: string | null;
  expectedCloseDate: string | null;
  lostReason: string | null;
}

const STAGE_LABEL: Record<OpportunityRow["stage"], string> = {
  NEW: "Yeni",
  QUALIFIED: "Nitelikli",
  PROPOSAL: "Teklif",
  WON: "Kazanıldı",
  LOST: "Kaybedildi",
};

function OpportunitiesModal({ customer, onClose }: { customer: CustomerRow; onClose: () => void }) {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "SALES"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");

  const opportunities = useQuery({
    queryKey: ["/opportunities", customer.id],
    queryFn: () => apiGet<OpportunityRow[]>(`/opportunities?customerId=${customer.id}`),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost("/opportunities", {
        customerId: customer.id,
        title,
        ...(estimatedValue ? { estimatedValue: Number(estimatedValue) } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/opportunities", customer.id] });
      setTitle("");
      setEstimatedValue("");
    },
    onError: () => toast("Fırsat eklenemedi", "error"),
  });

  const setStage = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: OpportunityRow["stage"] }) =>
      apiPatch(`/opportunities/${id}`, { stage }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/opportunities", customer.id] }),
    onError: () => toast("Aşama güncellenemedi", "error"),
  });

  return (
    <Modal open title={`${customer.name} — Fırsatlar`} onClose={onClose}>
      <div className="mb-4 max-h-80 space-y-3 overflow-y-auto">
        {opportunities.isLoading && <p className="text-sm text-slate-500">Yükleniyor…</p>}
        {opportunities.data?.length === 0 && <p className="text-sm text-slate-400">Henüz fırsat yok.</p>}
        {opportunities.data?.map((o) => (
          <div key={o.id} className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-700">{o.title}</span>
              {o.estimatedValue && <span className="text-slate-500">{o.estimatedValue}</span>}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
              {o.expectedCloseDate && <span>Beklenen kapanış: {fmtDate(o.expectedCloseDate)}</span>}
            </div>
            {canWrite ? (
              <Select
                className="mt-2 text-xs"
                value={o.stage}
                onChange={(e) => setStage.mutate({ id: o.id, stage: e.target.value as OpportunityRow["stage"] })}
              >
                {Object.entries(STAGE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="mt-1 text-xs">{STAGE_LABEL[o.stage]}</div>
            )}
          </div>
        ))}
      </div>
      {canWrite && (
        <div className="space-y-2">
          <div>
            <Label htmlFor="oppTitle">Fırsat Başlığı</Label>
            <Input id="oppTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="oppValue">Tahmini Değer</Label>
            <Input
              id="oppValue"
              type="number"
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
              Fırsat Ekle
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function CustomersPage() {
  const [notesCustomer, setNotesCustomer] = useState<CustomerRow | null>(null);
  const [oppCustomer, setOppCustomer] = useState<CustomerRow | null>(null);

  return (
    <>
      <CrudPage<CustomerRow>
        title="Müşteriler"
        icon={Users}
        endpoint="/customers"
        writeRoles={["ADMIN", "SALES"]}
        columns={[
          { key: "name", label: "Ad" },
          { key: "contactName", label: "İlgili Kişi" },
          { key: "phone", label: "Telefon" },
          { key: "email", label: "E-posta" },
          { key: "taxNo", label: "Vergi No" },
        ]}
        fields={[
          { name: "name", label: "Ad", required: true },
          { name: "contactName", label: "İlgili Kişi" },
          { name: "email", label: "E-posta", type: "email" },
          { name: "phone", label: "Telefon" },
          { name: "address", label: "Adres" },
          { name: "taxNo", label: "Vergi No" },
          { name: "notes", label: "Notlar" },
        ]}
        rowActions={(row) => (
          <div className="flex gap-1">
            <Button variant="ghost" className="px-2 py-1" title="Aktivite Notları" onClick={() => setNotesCustomer(row)}>
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button variant="ghost" className="px-2 py-1" title="Fırsatlar" onClick={() => setOppCustomer(row)}>
              <Target className="h-4 w-4" />
            </Button>
          </div>
        )}
      />
      {notesCustomer && <CustomerNotesModal customer={notesCustomer} onClose={() => setNotesCustomer(null)} />}
      {oppCustomer && <OpportunitiesModal customer={oppCustomer} onClose={() => setOppCustomer(null)} />}
    </>
  );
}
