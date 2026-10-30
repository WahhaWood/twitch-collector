import { Shell } from "@/components/shell";
import { StatsView } from "@/components/stats-view";

export default function StatsPage() {
  return (
    <Shell section="/stats">
      <h1 className="text-2xl font-semibold">Статистика</h1>
      <StatsView />
    </Shell>
  );
}
