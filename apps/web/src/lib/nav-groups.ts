import {
  Boxes,
  Briefcase,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Cog,
  Factory,
  FileText,
  Gauge,
  GitBranch,
  History,
  LayoutDashboard,
  Map,
  Network,
  Radio,
  ShieldAlert,
  ShoppingCart,
  Siren,
  FlaskConical,
  ListOrdered,
  Truck,
  Users,
  Users2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { PageKey } from "@ahkmes/shared-types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** PAGE_KEYS ile eşleşir — grup üyeliği bu sayfayı görüp göremeyeceğini belirler. Yoksa herkese açık. */
  page?: PageKey;
  /** Grup erişiminden bağımsız, sabit güvenlik tabanı (bkz. backend PagesGuard notları). */
  adminOnly?: boolean;
  end?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  items: NavItem[];
}

/**
 * ISA-95/IEC 62264 seviyelerine ve MESA-11 fonksiyonel modeline dayanan üçlü
 * gruplama (+ genel bakış): Level 4=ERP, Level 4↔3 köprüsü=MRP, Level 3=MES.
 * Hem Launchpad (giriş sonrası ana sayfa) hem AppLayout (sayfa içi ikon şeridi)
 * bu tek kaynaktan beslenir — iki yerde ayrı liste tutup birbirinden sapmasın diye.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "overview",
    label: "Genel Bakış",
    description: "Fabrika genelinde canlı özet: OEE, açık iş emirleri, uygunsuzluklar.",
    icon: LayoutDashboard,
    items: [{ to: "/dashboard", label: "Panel", icon: LayoutDashboard, end: true }],
  },
  {
    key: "erp",
    label: "ERP",
    description: "İşletme planlama: müşteri ilişkileri, teklif, satınalma, kullanıcı ve yetki yönetimi.",
    icon: Briefcase,
    items: [
      { to: "/customers", label: "Müşteriler", icon: Users, page: "customers" },
      { to: "/rfq", label: "Teklif Talepleri (RFQ)", icon: FileText, page: "rfq" },
      { to: "/quotes", label: "Teklifler", icon: FileText, page: "quotes" },
      { to: "/sales-orders", label: "Satış Siparişleri", icon: ShoppingCart, page: "sales-orders" },
      { to: "/purchase-orders", label: "Satınalma", icon: ShoppingCart, page: "purchase-orders" },
      { to: "/users", label: "Kullanıcılar", icon: Wrench, page: "users", adminOnly: true },
      { to: "/permission-groups", label: "Rol Grupları", icon: Users2, adminOnly: true },
      { to: "/audit-log", label: "Denetim İzi", icon: History, page: "audit-log", adminOnly: true },
    ],
  },
  {
    key: "mrp",
    label: "MRP",
    description: "Malzeme ve kaynak ihtiyaç planlama: parça, malzeme, tedarikçi ve iş emri yönetimi.",
    icon: Boxes,
    items: [
      { to: "/work-orders", label: "İş Emirleri", icon: ClipboardList, page: "work-orders" },
      { to: "/mrp", label: "MRP Planlama", icon: Boxes, page: "mrp" },
      { to: "/parts", label: "Parçalar", icon: Cog, page: "parts" },
      { to: "/suppliers", label: "Tedarikçiler", icon: Truck, page: "suppliers" },
      { to: "/materials", label: "Malzemeler", icon: Boxes, page: "materials" },
      { to: "/warehouses", label: "Depolar", icon: Boxes, page: "warehouses" },
      { to: "/lots", label: "Lot / Parti", icon: Boxes, page: "lots" },
      { to: "/transfer-orders", label: "Transfer Emirleri", icon: Boxes, page: "transfer-orders" },
      { to: "/cycle-counts", label: "Stok Sayımı", icon: Boxes, page: "cycle-counts" },
    ],
  },
  {
    key: "mes",
    label: "MES",
    description: "Üretim operasyonlarının gerçek zamanlı yürütülmesi: operasyon, tezgah, kalite, izlenebilirlik.",
    icon: Factory,
    items: [
      { to: "/production", label: "Operasyon", icon: Gauge, page: "production" },
      { to: "/machines", label: "Tezgahlar", icon: Factory, page: "machines" },
      { to: "/hierarchy", label: "Hiyerarşi", icon: GitBranch, page: "hierarchy" },
      { to: "/digital-twin", label: "Digital Twin", icon: Map, page: "digital-twin" },
      { to: "/automation-gateway", label: "Automation Gateway", icon: Radio, page: "automation-gateway" },
      { to: "/non-conformances", label: "Kalite", icon: ShieldAlert, page: "non-conformances" },
      { to: "/inspections", label: "Muayene", icon: ShieldAlert, page: "inspections" },
      { to: "/capa", label: "CAPA", icon: ShieldAlert, page: "capa" },
      { to: "/calibrations", label: "Kalibrasyon", icon: ShieldAlert, page: "calibrations" },
      { to: "/maintenance-orders", label: "Bakım Emirleri", icon: Factory, page: "maintenance-orders" },
      { to: "/recipes", label: "Reçeteler", icon: ListOrdered, page: "recipes" },
      { to: "/spc", label: "SPC", icon: FlaskConical, page: "spc" },
      { to: "/alarms", label: "Alarmlar", icon: Siren, page: "alarms" },
      { to: "/genealogy", label: "Genealogy", icon: Network, page: "genealogy" },
      { to: "/scheduling", label: "Scheduling", icon: CalendarDays, page: "scheduling" },
      { to: "/shift-report", label: "Vardiya Raporu", icon: CalendarClock, page: "shift-report" },
    ],
  },
];
