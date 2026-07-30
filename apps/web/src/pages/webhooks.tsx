import { Webhook } from "lucide-react";
import { CrudPage } from "../components/crud-page";

interface WebhookRow {
  id: string;
  url: string;
  event: string;
  isActive: boolean;
  lastTriggeredAt: string | null;
  lastStatus: string | null;
}

/** Faz J Developer Platform — dış sistemlere olay bildirimi. Mevcut
 * RealtimeGateway.emitToTenant() olaylarının tamamına ("*") veya tek bir
 * olaya (örn. "workorder.updated") abone olunabilir. Sadece ADMIN görür. */
export function WebhooksPage() {
  return (
    <CrudPage<WebhookRow>
      title="Webhook'lar"
      icon={Webhook}
      endpoint="/webhooks"
      writeRoles={["ADMIN"]}
      searchable={false}
      columns={[
        { key: "url", label: "URL" },
        { key: "event", label: "Olay" },
        { key: "isActive", label: "Aktif", render: (r) => (r.isActive ? "Evet" : "Hayır") },
        {
          key: "lastStatus",
          label: "Son Deneme",
          render: (r) =>
            r.lastStatus ? (
              <span className={r.lastStatus === "success" ? "text-green-600" : "text-red-600"}>
                {r.lastStatus === "success" ? "Başarılı" : "Başarısız"}
              </span>
            ) : (
              "—"
            ),
        },
      ]}
      fields={[
        { name: "url", label: "URL (https://...)", required: true },
        { name: "event", label: "Olay adı (örn. workorder.updated, ya da tümü için *)", required: true },
        { name: "secret", label: "İmza Anahtarı (opsiyonel, X-Webhook-Signature)" },
        { name: "isActive", label: "Aktif", type: "checkbox" },
      ]}
    />
  );
}
