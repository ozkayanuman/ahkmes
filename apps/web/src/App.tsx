import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout";
import { LoginPage } from "./pages/login";
import { DashboardPage } from "./pages/dashboard";
import { CustomersPage } from "./pages/customers";
import { PartsPage } from "./pages/parts";
import { SuppliersPage } from "./pages/suppliers";
import { MaterialsPage } from "./pages/materials";
import { MachinesPage } from "./pages/machines";
import { UsersPage } from "./pages/users";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/parts" element={<PartsPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/materials" element={<MaterialsPage />} />
        <Route path="/machines" element={<MachinesPage />} />
        <Route path="/users" element={<UsersPage />} />
      </Route>
    </Routes>
  );
}
