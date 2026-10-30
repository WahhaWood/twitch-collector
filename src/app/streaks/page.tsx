import { Shell } from "@/components/shell";
import { StreaksView } from "@/components/streaks-view";

export default function StreaksPage() {
  return (
    <Shell section="/streaks">
      <h1 className="text-2xl font-semibold">Стрики</h1>
      <StreaksView />
    </Shell>
  );
}
