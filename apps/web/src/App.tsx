import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout";
import { LoginPage } from "./pages/login";
import { DashboardPage } from "./pages/dashboard";
import { CustomersPage } from "./pages/customers";
import { PartsPage } from "./pages/parts";
import { SuppliersPage } from "./pages/suppliers";
import { MaterialsPage } from "./pages/materials";
import { MachinesPage } from "./pages/machines";
import { AutomationGatewayPage } from "./pages/automation-gateway";
import { NonConformancesPage } from "./pages/non-conformances";
import { MrpPage } from "./pages/mrp";
import { GenealogyPage } from "./pages/genealogy";
import { SchedulingPage } from "./pages/scheduling";
import { UsersPage } from "./pages/users";
import { QuotesPage } from "./pages/quotes";
import { QuoteDetailPage } from "./pages/quote-detail";
import { WorkOrdersPage } from "./pages/work-orders";
import { WorkOrderDetailPage } from "./pages/work-order-detail";
import { PurchaseOrdersPage } from "./pages/purchase-orders";
import { PurchaseOrderDetailPage } from "./pages/purchase-order-detail";
import { ProductionPage } from "./pages/production";
import { HierarchyPage } from "./pages/hierarchy";
import { DigitalTwinPage } from "./pages/digital-twin";
import { AndonPage } from "./pages/andon";
import { AuditLogPage } from "./pages/audit-log";
import { ShiftReportPage } from "./pages/shift-report";
import { PermissionGroupsPage } from "./pages/permission-groups";
import { PageGuard } from "./components/page-guard";
import { LaunchpadPage } from "./pages/launchpad";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<LaunchpadPage />} />
      <Route path="/andon" element={<AndonPage />} />
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/customers" element={<PageGuard page="customers"><CustomersPage /></PageGuard>} />
        <Route path="/quotes" element={<PageGuard page="quotes"><QuotesPage /></PageGuard>} />
        <Route path="/quotes/:id" element={<PageGuard page="quotes"><QuoteDetailPage /></PageGuard>} />
        <Route path="/work-orders" element={<PageGuard page="work-orders"><WorkOrdersPage /></PageGuard>} />
        <Route
          path="/work-orders/:id"
          element={
            <PageGuard page="work-orders">
              <WorkOrderDetailPage />
            </PageGuard>
          }
        />
        <Route
          path="/purchase-orders"
          element={
            <PageGuard page="purchase-orders">
              <PurchaseOrdersPage />
            </PageGuard>
          }
        />
        <Route
          path="/purchase-orders/:id"
          element={
            <PageGuard page="purchase-orders">
              <PurchaseOrderDetailPage />
            </PageGuard>
          }
        />
        <Route path="/production" element={<PageGuard page="production"><ProductionPage /></PageGuard>} />
        <Route path="/parts" element={<PageGuard page="parts"><PartsPage /></PageGuard>} />
        <Route path="/suppliers" element={<PageGuard page="suppliers"><SuppliersPage /></PageGuard>} />
        <Route path="/materials" element={<PageGuard page="materials"><MaterialsPage /></PageGuard>} />
        <Route path="/machines" element={<PageGuard page="machines"><MachinesPage /></PageGuard>} />
        <Route path="/hierarchy" element={<PageGuard page="hierarchy"><HierarchyPage /></PageGuard>} />
        <Route path="/digital-twin" element={<PageGuard page="digital-twin"><DigitalTwinPage /></PageGuard>} />
        <Route
          path="/automation-gateway"
          element={
            <PageGuard page="automation-gateway">
              <AutomationGatewayPage />
            </PageGuard>
          }
        />
        <Route
          path="/non-conformances"
          element={
            <PageGuard page="non-conformances">
              <NonConformancesPage />
            </PageGuard>
          }
        />
        <Route path="/mrp" element={<PageGuard page="mrp"><MrpPage /></PageGuard>} />
        <Route path="/genealogy" element={<PageGuard page="genealogy"><GenealogyPage /></PageGuard>} />
        <Route path="/scheduling" element={<PageGuard page="scheduling"><SchedulingPage /></PageGuard>} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/permission-groups" element={<PermissionGroupsPage />} />
        <Route path="/audit-log" element={<AuditLogPage />} />
        <Route path="/shift-report" element={<PageGuard page="shift-report"><ShiftReportPage /></PageGuard>} />
      </Route>
    </Routes>
  );
}
