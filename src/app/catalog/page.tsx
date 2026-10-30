import { CatalogView } from "@/components/catalog-view";
import { Shell } from "@/components/shell";
import { PageHead } from "@/components/ui";

export default function CatalogPage() {
  return (
    <Shell section="/catalog">
      <PageHead title="Все награды">
        Все дропсы и значки Twitch, которые видит сервис, независимо от ваших аккаунтов. Здесь можно искать и смотреть, что скоро закончится. Ваш личный прогресс — на странице аккаунта.
      </PageHead>
      <CatalogView />
    </Shell>
  );
}
