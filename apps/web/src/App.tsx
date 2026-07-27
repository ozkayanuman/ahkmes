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

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/quotes" element={<QuotesPage />} />
        <Route path="/quotes/:id" element={<QuoteDetailPage />} />
        <Route path="/work-orders" element={<WorkOrdersPage />} />
        <Route path="/work-orders/:id" element={<WorkOrderDetailPage />} />
        <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
        <Route path="/production" element={<ProductionPage />} />
        <Route path="/parts" element={<PartsPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/materials" element={<MaterialsPage />} />
        <Route path="/machines" element={<MachinesPage />} />
        <Route path="/automation-gateway" element={<AutomationGatewayPage />} />
        <Route path="/non-conformances" element={<NonConformancesPage />} />
        <Route path="/genealogy" element={<GenealogyPage />} />
        <Route path="/scheduling" element={<SchedulingPage />} />
        <Route path="/users" element={<UsersPage />} />
      </Route>
    </Routes>
  );
}
