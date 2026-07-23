import {
  Boxes,
  Cog,
  Factory,
  LayoutDashboard,
  LogOut,
  Package,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import { NavLink, Navigate, Outlet } from "react-router-dom";
import { clsx } from "clsx";
import { useAuth } from "../lib/auth";

const NAV = [
  { to: "/", label: "Panel", icon: LayoutDashboard, end: true },
  { to: "/customers", label: "Müşteriler", icon: Users },
  { to: "/parts", label: "Parçalar", icon: Cog },
  { to: "/suppliers", label: "Tedarikçiler", icon: Truck },
  { to: "/materials", label: "Malzemeler", icon: Boxes },
  { to: "/machines", label: "Tezgahlar", icon: Factory },
  { to: "/users", label: "Kullanıcılar", icon: Wrench, adminOnly: true },
];

export function AppLayout() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Yükleniyor…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-4">
          <Package className="h-6 w-6 text-brand-600" />
          <span className="text-lg font-bold">AHKMES</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.filter((n) => !n.adminOnly || user.role === "ADMIN").map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                  isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <div className="mb-2 px-3 text-sm">
            <div className="font-medium">{user.name}</div>
            <div className="text-xs text-slate-500">{user.role}</div>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" />
            Çıkış
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
