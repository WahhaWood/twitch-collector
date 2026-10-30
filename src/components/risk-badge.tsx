import type { Risk } from "@/lib/client";
import { Pill } from "./ui";

const RISK: Record<Risk, { label: string; tone: string }> = {
  ok: { label: "успеваете", tone: "bg-ok-bg text-ok" },
  tight: { label: "впритык", tone: "bg-warn-bg text-warn" },
  impossible: { label: "не успеть", tone: "bg-bad-bg text-bad" },
};

export function RiskBadge({ risk }: { risk: Risk | null }) {
  if (!risk) return null;
  return <Pill tone={RISK[risk].tone}>{RISK[risk].label}</Pill>;
}
