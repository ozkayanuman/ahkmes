import { ArrowLeft, LogOut } from "lucide-react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { PAGE_PRODUCT_MODULE, type PageKey, type ProductModule } from "@ahkmes/shared-types";
import { useAuth, hasPageAccess } from "../lib/auth";
import { apiGet } from "../lib/api";
import { NAV_GROUPS, type NavGroup } from "../lib/nav-groups";
import { GlobalStatusBar } from "./global-status-bar";
import { LanguageSwitcher } from "./language-switcher";

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
  const { t } = useTranslation();
  const location = useLocation();
  const active = isGroupActive(group, location.pathname);
  const GroupIconCmp = group.icon;

  if (group.items.length === 1) {
    const only = group.items[0];
    return (
      <NavLink
        to={only.to}
        end={only.end}
        title={t(group.label)}
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
        title={t(group.label)}
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
            {t(group.label)}
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
                {t(item.label)}
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
  const { t } = useTranslation();
  const { user, loading, logout } = useAuth();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const entitlements = useQuery({
    queryKey: ["/platform/modules"],
    queryFn: () => apiGet<Array<{ module: ProductModule; isEnabled: boolean }>>("/platform/modules"),
    enabled: !!user,
    staleTime: 30_000,
  });

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">{t("Yükleniyor…")}</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  const disabledModules = new Set<ProductModule | "PLATFORM_CORE">(
    (entitlements.data ?? []).filter((item) => !item.isEnabled).map((item) => item.module),
  );
  // "platform-modules" is the single recovery route — an administrator must
  // always be able to reach it to re-enable a disabled module, mirroring
  // PageGuard's carve-out.
  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((n) => {
      if (n.adminOnly && user.role !== "ADMIN") return false;
      if (n.page && !hasPageAccess(user, n.page)) return false;
      if (n.page === "platform-modules") return true;
      const module = n.page ? PAGE_PRODUCT_MODULE[n.page as PageKey] : undefined;
      if (module && disabledModules.has(module)) return false;
      return true;
    }),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-16 flex-col border-r border-slate-200 bg-white print:hidden">
        <Link
          to="/"
          title={t("Ana Sayfaya Dön")}
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
          <LanguageSwitcher />
          <button
            onClick={logout}
            title={t("Çıkış")}
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
