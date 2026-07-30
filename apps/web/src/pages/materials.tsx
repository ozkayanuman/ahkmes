import { Boxes } from "lucide-react";
import { CrudPage } from "../components/crud-page";
import { useInvalidateOn } from "../lib/socket";

interface MaterialRow {
  id: string;
  code: string;
  name: string;
  type: "RAW" | "CONSUMABLE";
  unit: string;
  stockQty: string;
  minStock?: string | null;
}

export function MaterialsPage() {
  // Teslim alma stok değiştirdiğinde liste canlı güncellensin
  useInvalidateOn(["stock.updated"], ["/materials"]);
  return (
    <CrudPage<MaterialRow>
      title="Malzemeler"
      icon={Boxes}
      endpoint="/materials"
      writeRoles={["ADMIN", "PLANNER"]}
      columns={[
        { key: "code", label: "Kod" },
        { key: "name", label: "Ad" },
        {
          key: "type",
          label: "Tür",
          render: (r) => (r.type === "RAW" ? "Hammadde" : "Sarf"),
        },
        { key: "unit", label: "Birim" },
        { key: "stockQty", label: "Stok" },
        { key: "minStock", label: "Min. Stok" },
      ]}
      fields={[
        { name: "code", label: "Kod", required: true },
        { name: "name", label: "Ad", required: true },
        {
          name: "type",
          label: "Tür",
          type: "select",
          required: true,
          options: [
            { value: "RAW", label: "Hammadde" },
            { value: "CONSUMABLE", label: "Sarf Malzeme" },
          ],
        },
        { name: "unit", label: "Birim (kg, adet, m…)", required: true },
        { name: "minStock", label: "Minimum Stok", type: "number" },
        { name: "standardCost", label: "Standart Birim Maliyet", type: "number" },
      ]}
    />
  );
}
