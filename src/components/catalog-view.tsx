"use client";

import { useState } from "react";
import useSWR from "swr";
import { type CatalogItem, fetcher, POLL_MS } from "@/lib/client";
import { SUB_HINT, timeLeft } from "@/lib/format";
import { useNow } from "./progress-row";
import { Card, Empty, ErrorBox, KindBadge, Skeleton, Thumb } from "./ui";

type Kind = "all" | "drop" | "badge";
const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "drop", label: "Дропсы" },
  { value: "badge", label: "Значки" },
];
const WITHIN: { value: number; label: string }[] = [
  { value: 0, label: "Любая дата окончания" },
  { value: 1, label: "Заканчивается за 24 ч" },
  { value: 3, label: "За 3 дня" },
  { value: 7, label: "За 7 дней" },
];
const SELECT =
  "rounded-lg border border-line bg-sf px-3 py-2 text-sm";

export function CatalogView() {
  const [kind, setKind] = useState<Kind>("all");
  const [game, setGame] = useState("");
  const [within, setWithin] = useState(0);
  const [query, setQuery] = useState("");
  const now = useNow();
  const { data, error } = useSWR<{ items: CatalogItem[] }>(
    kind === "all" ? "/api/campaigns" : `/api/campaigns?kind=${kind}`,
    fetcher,
    { refreshInterval: POLL_MS, keepPreviousData: true },
  );

  if (error) return <ErrorBox>Не удалось загрузить каталог</ErrorBox>;

  const items = data?.items ?? [];
  const games = [...new Set(items.map((i) => i.gameName).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b));
  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (!game || i.gameName === game) &&
      (!q || [i.name, i.campaignName, i.gameName].some((v) => v?.toLowerCase().includes(q))) &&
      (!within || (i.endsAt !== null && new Date(i.endsAt).getTime() - now <= within * 86_400_000)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по награде, кампании, игре"
          aria-label="Поиск"
          className={`${SELECT} w-full sm:w-64`}
        />
        <div className="flex gap-1 rounded-lg bg-sf2 p-1">
          {KINDS.map((k) => (
            <button
              key={k.value}
              onClick={() => setKind(k.value)}
              className={`rounded-md px-3 py-1.5 text-sm ${kind === k.value ? "bg-sf font-medium shadow-sm" : "text-mut"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <select value={game} onChange={(e) => setGame(e.target.value)} className={SELECT} aria-label="Игра">
          <option value="">Все игры</option>
          {games.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select value={within} onChange={(e) => setWithin(Number(e.target.value))} className={SELECT} aria-label="Окончание">
          {WITHIN.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </div>

      {!data ? (
        <Skeleton rows={4} />
      ) : shown.length === 0 ? (
        <Empty>{items.length ? "Ничего не подходит под фильтры." : "Каталог пуст: он заполняется при синхронизации аккаунтов."}</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((item) => (
            <Card key={item.id} className="flex min-w-0 gap-3">
              <Thumb src={item.imageUrl} alt={item.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-medium">{item.name}</p>
                  <KindBadge kind={item.kind} />
                </div>
                <p className="truncate text-xs text-mut">{[item.gameName, item.campaignName].filter(Boolean).join(" · ")}</p>
                <p className="mt-1 text-xs text-mut">
                  {[item.requiredMinutes ? `${item.requiredMinutes} мин просмотра` : item.requiredSubs ? SUB_HINT : null, timeLeft(item.endsAt, now)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
