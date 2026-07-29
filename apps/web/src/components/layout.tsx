import { ArrowLeft, LogOut } from "lucide-react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { useState } from "react";
import { useAuth, hasPageAccess } from "../lib/auth";
import { NAV_GROUPS, type NavGroup } from "../lib/nav-groups";
import { GlobalStatusBar } from "./global-status-bar";

function isGroupActive(group: NavGroup, pathname: string) {
  return group.items.some((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));
}

/** Grup ikonu — üzerine gelinince veya tıklanınca sağa doğru açılan, alt sayfaları
 * listeleyen bir flyout menü gösterir. Tek maddeli gruplar (Genel Bakış) doğrudan
 * bağlantı olarak render edilir; flyout gereksiz bir tık eklemesin diye. */
function GroupIcon({
  group,
  open,
  onOpen,
  onClose,
}: {
  group: NavGroup;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const location = useLocation();
  const active = isGroupActive(group, location.pathname);
  const GroupIconCmp = group.icon;

  if (group.items.length === 1) {
    const only = group.items[0];
    return (
      <NavLink
        to={only.to}
        end={only.end}
        title={group.label}
        className={({ isActive }) =>
          clsx(
            "flex items-center justify-center rounded-md py-2 text-sm font-medium",
            isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
          )
        }
      >
        <GroupIconCmp className="h-4 w-4 shrink-0" />
      </NavLink>
    );
  }

  return (
    <div className="relative" onMouseEnter={onOpen} onMouseLeave={onClose}>
      <button
        onClick={() => (open ? onClose() : onOpen())}
        title={group.label}
        className={clsx(
          "flex w-full items-center justify-center rounded-md py-2 text-sm font-medium",
          active || open ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
        )}
      >
        <GroupIconCmp className="h-4 w-4 shrink-0" />
      </button>
      {open && (
        <div className="absolute left-full top-0 z-50 ml-1 w-48 rounded-lg border border-slate-200 bg-white py-2 shadow-lg">
          <div className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {group.label}
          </div>
          {group.items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onClose}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-2.5 px-3 py-2 text-sm",
                    isActive ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50",
                  )
                }
              >
                <ItemIcon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Sayfa içindeyken sol kenar çubuğu her zaman ikon-only'dir (Launchpad'in tersine,
 * burada genişletme/daraltma yoktur) — ana başlıklar kadar (Genel Bakış/ERP/MRP/MES)
 * ikon gösterilir, her biri üzerine gelinince/tıklanınca sağa açılan bir flyout ile
 * alt sayfaları listeler. */
export function AppLayout() {
  const { user, loading, logout } = useAuth();
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Yükleniyor…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (n) => (!n.adminOnly || user.role === "ADMIN") && (!n.page || hasPageAccess(user, n.page)),
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-16 flex-col border-r border-slate-200 bg-white print:hidden">
        <Link
          to="/"
          title="Ana Sayfaya Dön"
          className="flex items-center justify-center border-b border-slate-200 py-4 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <nav className="flex-1 space-y-1 overflow-visible p-2 py-3">
          {visibleGroups.map((g) => (
            <GroupIcon
              key={g.key}
              group={g}
              open={openGroup === g.key}
              onOpen={() => setOpenGroup(g.key)}
              onClose={() => setOpenGroup(null)}
            />
          ))}
        </nav>
        <div className="border-t border-slate-200 p-2">
          <button
            onClick={logout}
            title="Çıkış"
            className="flex w-full items-center justify-center rounded-md py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4 shrink-0" />
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
