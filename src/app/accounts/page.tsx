import { AccountsView } from "@/components/accounts-view";
import { Shell } from "@/components/shell";

export default function AccountsPage() {
  return (
    <Shell section="/accounts">
      <h1 className="text-2xl font-semibold">Аккаунты</h1>
      <AccountsView />
    </Shell>
  );
}
