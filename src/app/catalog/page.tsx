import { CatalogView } from "@/components/catalog-view";
import { Shell } from "@/components/shell";

export default function CatalogPage() {
  return (
    <Shell section="/catalog">
      <h1 className="text-2xl font-semibold">Каталог</h1>
      <CatalogView />
    </Shell>
  );
}
