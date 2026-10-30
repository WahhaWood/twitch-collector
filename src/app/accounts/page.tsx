import { AccountsView } from "@/components/accounts-view";
import { Shell } from "@/components/shell";
import { PageHead } from "@/components/ui";

export default function AccountsPage() {
  return (
    <Shell section="/accounts">
      <PageHead title="Аккаунты">
        Ваши Twitch-аккаунты. Подключите аккаунт, и сервис начнёт следить за его дропсами; включите автопросмотр, чтобы стримы смотрел воркер.
      </PageHead>
      <AccountsView />
    </Shell>
  );
}
