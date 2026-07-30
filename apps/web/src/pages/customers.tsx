import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Users } from "lucide-react";
import { useState } from "react";
import { CrudPage } from "../components/crud-page";
import { apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Modal, Textarea } from "../components/ui";
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

export function CustomersPage() {
  const [notesCustomer, setNotesCustomer] = useState<CustomerRow | null>(null);

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
          <Button variant="ghost" className="px-2 py-1" title="Aktivite Notları" onClick={() => setNotesCustomer(row)}>
            <MessageSquare className="h-4 w-4" />
          </Button>
        )}
      />
      {notesCustomer && <CustomerNotesModal customer={notesCustomer} onClose={() => setNotesCustomer(null)} />}
    </>
  );
}
