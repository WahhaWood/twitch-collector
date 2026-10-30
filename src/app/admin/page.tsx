import { AdminView } from "@/components/admin-view";
import { Shell } from "@/components/shell";

export default function AdminPage() {
  return (
    <Shell section="/admin">
      <h1 className="text-2xl font-semibold">Пользователи</h1>
      <AdminView />
    </Shell>
  );
}
