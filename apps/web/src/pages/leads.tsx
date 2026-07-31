import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightCircle, UserPlus } from "lucide-react";
import { CrudPage } from "../components/crud-page";
import { ApiError, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui";
import { useToast } from "../components/toast";

interface LeadRow {
  id: string;
  companyName: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status: "NEW" | "QUALIFIED" | "DISQUALIFIED" | "CONVERTED";
}

const STATUS_LABEL: Record<LeadRow["status"], string> = {
  NEW: "Yeni",
  QUALIFIED: "Nitelikli",
  DISQUALIFIED: "Elenmiş",
  CONVERTED: "Dönüştürüldü",
};

function ConvertButton({ lead }: { lead: LeadRow }) {
  const { user } = useAuth();
  const canConvert = !!user && ["ADMIN", "SALES"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();

  const convert = useMutation({
    mutationFn: () => apiPost(`/leads/${lead.id}/convert`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/leads"] });
      qc.invalidateQueries({ queryKey: ["/customers"] });
      toast("Müşteriye dönüştürüldü", "success");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Dönüştürülemedi", "error");
    },
  });

  if (!canConvert || lead.status === "CONVERTED") return null;

  return (
    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => convert.mutate()} disabled={convert.isPending}>
      <ArrowRightCircle className="h-4 w-4" /> Müşteriye Dönüştür
    </Button>
  );
}

export function LeadsPage() {
  return (
    <CrudPage<LeadRow>
      title="Potansiyel Müşteriler (Leads)"
      icon={UserPlus}
      endpoint="/leads"
      writeRoles={["ADMIN", "SALES"]}
      columns={[
        { key: "companyName", label: "Şirket" },
        { key: "contactName", label: "İlgili Kişi" },
        { key: "email", label: "E-posta" },
        { key: "phone", label: "Telefon" },
        { key: "source", label: "Kaynak" },
        { key: "status", label: "Durum", render: (row) => STATUS_LABEL[row.status] },
      ]}
      fields={[
        { name: "companyName", label: "Şirket", required: true },
        { name: "contactName", label: "İlgili Kişi" },
        { name: "email", label: "E-posta", type: "email" },
        { name: "phone", label: "Telefon" },
        { name: "source", label: "Kaynak (örn. Web, Fuar, Referans)" },
        {
          name: "status",
          label: "Durum",
          type: "select",
          options: [
            { value: "NEW", label: "Yeni" },
            { value: "QUALIFIED", label: "Nitelikli" },
            { value: "DISQUALIFIED", label: "Elenmiş" },
          ],
        },
      ]}
      rowActions={(row) => <ConvertButton lead={row} />}
    />
  );
}
