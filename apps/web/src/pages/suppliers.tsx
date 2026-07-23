import { CrudPage } from "../components/crud-page";

interface SupplierRow {
  id: string;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export function SuppliersPage() {
  return (
    <CrudPage<SupplierRow>
      title="Tedarikçiler"
      endpoint="/suppliers"
      writeRoles={["ADMIN", "PLANNER"]}
      columns={[
        { key: "name", label: "Ad" },
        { key: "contactName", label: "İlgili Kişi" },
        { key: "phone", label: "Telefon" },
        { key: "email", label: "E-posta" },
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
    />
  );
}
