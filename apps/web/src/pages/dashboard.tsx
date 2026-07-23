import { Card } from "../components/ui";
import { useAuth } from "../lib/auth";

export function DashboardPage() {
  const { user } = useAuth();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Panel</h1>
      <Card>
        <p className="text-slate-600">
          Hoş geldin, <span className="font-medium text-slate-900">{user?.name}</span>. Faz 0a
          kapsamında temel kayıt ekranları soldaki menüde. İş emri, teklif ve stok akışı panelleri
          Faz 0b/0c ile eklenecek.
        </p>
      </Card>
    </div>
  );
}
