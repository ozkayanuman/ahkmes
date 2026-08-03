import { clsx } from "clsx";
import { useTranslation } from "react-i18next";

type StatusInfo = { label: string; cls: string };

export const QUOTE_STATUS: Record<string, StatusInfo> = {
  DRAFT: { label: "Taslak", cls: "bg-slate-100 text-slate-700" },
  SENT: { label: "Gönderildi", cls: "bg-blue-100 text-blue-700" },
  APPROVED: { label: "Onaylandı", cls: "bg-green-100 text-green-700" },
  REJECTED: { label: "Reddedildi", cls: "bg-red-100 text-red-700" },
};

export const WO_STATUS: Record<string, StatusInfo> = {
  PLANNED: { label: "Planlandı", cls: "bg-slate-100 text-slate-700" },
  WAITING_MATERIAL: { label: "Malzeme Bekliyor", cls: "bg-amber-100 text-amber-700" },
  IN_PRODUCTION: { label: "Üretimde", cls: "bg-blue-100 text-blue-700" },
  COMPLETED: { label: "Tamamlandı", cls: "bg-green-100 text-green-700" },
  CANCELLED: { label: "İptal", cls: "bg-red-100 text-red-700" },
};

export const PO_STATUS: Record<string, StatusInfo> = {
  ORDERED: { label: "Sipariş Verildi", cls: "bg-slate-100 text-slate-700" },
  IN_TRANSIT: { label: "Yolda", cls: "bg-blue-100 text-blue-700" },
  RECEIVED: { label: "Teslim Alındı", cls: "bg-green-100 text-green-700" },
  CANCELLED: { label: "İptal", cls: "bg-red-100 text-red-700" },
};

export const RFQ_STATUS: Record<string, StatusInfo> = {
  DRAFT: { label: "Taslak", cls: "bg-slate-100 text-slate-700" },
  SENT: { label: "Gönderildi", cls: "bg-blue-100 text-blue-700" },
  CONVERTED: { label: "Teklife Dönüştü", cls: "bg-green-100 text-green-700" },
  CLOSED: { label: "Kapatıldı", cls: "bg-slate-100 text-slate-500" },
};

export const SALES_ORDER_STATUS: Record<string, StatusInfo> = {
  OPEN: { label: "Açık", cls: "bg-blue-100 text-blue-700" },
  CLOSED: { label: "Kapatıldı", cls: "bg-green-100 text-green-700" },
  CANCELLED: { label: "İptal", cls: "bg-red-100 text-red-700" },
};

export function StatusBadge({
  map,
  status,
}: {
  map: Record<string, StatusInfo>;
  status: string;
}) {
  const { t } = useTranslation();
  const s = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-700" };
  return (
    <span className={clsx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", s.cls)}>
      {t(s.label)}
    </span>
  );
}
