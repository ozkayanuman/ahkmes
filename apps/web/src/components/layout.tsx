import {
  Boxes,
  CalendarClock,
  ClipboardList,
  Cog,
  Factory,
  FileText,
  Gauge,
  History,
  LayoutDashboard,
  LogOut,
  GitBranch,
  Map,
  Menu,
  Network,
  Package,
  CalendarDays,
  Radio,
  ShieldAlert,
  ShoppingCart,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import { NavLink, Navigate, Outlet } from "react-router-dom";
import { clsx } from "clsx";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { GlobalStatusBar } from "./global-status-bar";

const NAV = [
  { to: "/", label: "Panel", icon: LayoutDashboard, end: true },
  { to: "/customers", label: "Müşteriler", icon: Users },
  { to: "/quotes", label: "Teklifler", icon: FileText },
  { to: "/work-orders", label: "İş Emirleri", icon: ClipboardList },
  { to: "/purchase-orders", label: "Satınalma", icon: ShoppingCart },
  { to: "/production", label: "Operasyon", icon: Gauge },
  { to: "/parts", label: "Parçalar", icon: Cog },
  { to: "/suppliers", label: "Tedarikçiler", icon: Truck },
  { to: "/materials", label: "Malzemeler", icon: Boxes },
  { to: "/machines", label: "Tezgahlar", icon: Factory },
  { to: "/hierarchy", label: "Hiyerarşi", icon: GitBranch },
  { to: "/digital-twin", label: "Digital Twin", icon: Map },
  { to: "/automation-gateway", label: "Automation Gateway", icon: Radio },
  { to: "/non-conformances", label: "Kalite", icon: ShieldAlert },
  { to: "/genealogy", label: "Genealogy", icon: Network },
  { to: "/scheduling", label: "Scheduling", icon: CalendarDays },
  { to: "/shift-report", label: "Vardiya Raporu", icon: CalendarClock },
  { to: "/users", label: "Kullanıcılar", icon: Wrench, adminOnly: true },
  { to: "/audit-log", label: "Denetim İzi", icon: History, adminOnly: true },
];

export function AppLayout() {
  const { user, loading, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Yükleniyor…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen">
      <aside
        className={clsx(
          "flex flex-col border-r border-slate-200 bg-white transition-[width] duration-200 print:hidden",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div
          className={clsx(
            "flex items-center border-b border-slate-200 py-4",
            collapsed ? "justify-center px-2" : "gap-2 px-4",
          )}
        >
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
            title={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
          >
            <Menu className="h-5 w-5" />
          </button>
          {!collapsed && (
            <>
              <Package className="h-6 w-6 text-brand-600" />
              <span className="text-lg font-bold">AHKMES</span>
            </>
          )}
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.filter((n) => !n.adminOnly || user.role === "ADMIN").map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                clsx(
                  "flex items-center rounded-md py-2 text-sm font-medium",
                  collapsed ? "justify-center px-2" : "gap-3 px-3",
                  isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3">
          {!collapsed && (
            <div className="mb-2 px-3 text-sm">
              <div className="font-medium">{user.name}</div>
              <div className="text-xs text-slate-500">{user.role}</div>
            </div>
          )}
          <button
            onClick={logout}
            title={collapsed ? "Çıkış" : undefined}
            className={clsx(
              "flex w-full items-center rounded-md py-2 text-sm text-slate-600 hover:bg-slate-100",
              collapsed ? "justify-center px-2" : "gap-3 px-3",
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && "Çıkış"}
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden p-6">
        <GlobalStatusBar />
        <Outlet />
      </main>
    </div>
  );
}
