import { CrudPage } from "../components/crud-page";

interface CustomerRow {
  id: string;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  taxNo?: string | null;
}

export function CustomersPage() {
  return (
    <CrudPage<CustomerRow>
      title="Müşteriler"
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
    />
  );
}
