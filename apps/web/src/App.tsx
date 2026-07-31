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
import { RfqPage } from "./pages/rfq";
import { SalesOrdersPage } from "./pages/sales-orders";
import { SalesOrderDetailPage } from "./pages/sales-order-detail";
import { WarehousesPage } from "./pages/warehouses";
import { LotsPage } from "./pages/lots";
import { SerialNumbersPage } from "./pages/serial-numbers";
import { TransferOrdersPage } from "./pages/transfer-orders";
import { CycleCountsPage } from "./pages/cycle-counts";
import { InspectionsPage } from "./pages/inspections";
import { CapaPage } from "./pages/capa";
import { CalibrationsPage } from "./pages/calibrations";
import { MaintenanceOrdersPage } from "./pages/maintenance-orders";
import { RecipesPage } from "./pages/recipes";
import { SpcPage } from "./pages/spc";
import { AlarmsPage } from "./pages/alarms";
import { ApPage } from "./pages/ap";
import { ArPage } from "./pages/ar";
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
import { LaborPage } from "./pages/labor";
import { EnergyPage } from "./pages/energy";
import { WebhooksPage } from "./pages/webhooks";
import { ReportsPage } from "./pages/reports";
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
        <Route path="/rfq" element={<PageGuard page="rfq"><RfqPage /></PageGuard>} />
        <Route path="/quotes" element={<PageGuard page="quotes"><QuotesPage /></PageGuard>} />
        <Route path="/quotes/:id" element={<PageGuard page="quotes"><QuoteDetailPage /></PageGuard>} />
        <Route path="/sales-orders" element={<PageGuard page="sales-orders"><SalesOrdersPage /></PageGuard>} />
        <Route
          path="/sales-orders/:id"
          element={
            <PageGuard page="sales-orders">
              <SalesOrderDetailPage />
            </PageGuard>
          }
        />
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
        <Route path="/warehouses" element={<PageGuard page="warehouses"><WarehousesPage /></PageGuard>} />
        <Route path="/lots" element={<PageGuard page="lots"><LotsPage /></PageGuard>} />
        <Route path="/serial-numbers" element={<PageGuard page="serial-numbers"><SerialNumbersPage /></PageGuard>} />
        <Route path="/transfer-orders" element={<PageGuard page="transfer-orders"><TransferOrdersPage /></PageGuard>} />
        <Route path="/cycle-counts" element={<PageGuard page="cycle-counts"><CycleCountsPage /></PageGuard>} />
        <Route path="/inspections" element={<PageGuard page="inspections"><InspectionsPage /></PageGuard>} />
        <Route path="/capa" element={<PageGuard page="capa"><CapaPage /></PageGuard>} />
        <Route path="/calibrations" element={<PageGuard page="calibrations"><CalibrationsPage /></PageGuard>} />
        <Route path="/maintenance-orders" element={<PageGuard page="maintenance-orders"><MaintenanceOrdersPage /></PageGuard>} />
        <Route path="/energy" element={<PageGuard page="energy"><EnergyPage /></PageGuard>} />
        <Route path="/recipes" element={<PageGuard page="recipes"><RecipesPage /></PageGuard>} />
        <Route path="/spc" element={<PageGuard page="spc"><SpcPage /></PageGuard>} />
        <Route path="/alarms" element={<PageGuard page="alarms"><AlarmsPage /></PageGuard>} />
        <Route path="/ar" element={<PageGuard page="ar"><ArPage /></PageGuard>} />
        <Route path="/ap" element={<PageGuard page="ap"><ApPage /></PageGuard>} />
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
        <Route path="/reports" element={<PageGuard page="reports"><ReportsPage /></PageGuard>} />
        <Route path="/webhooks" element={<PageGuard page="webhooks"><WebhooksPage /></PageGuard>} />
        <Route path="/shift-report" element={<PageGuard page="shift-report"><ShiftReportPage /></PageGuard>} />
        <Route path="/labor" element={<PageGuard page="labor"><LaborPage /></PageGuard>} />
      </Route>
    </Routes>
  );
}
