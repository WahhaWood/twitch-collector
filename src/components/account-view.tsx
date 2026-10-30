"use client";

import { useState } from "react";
import useSWR from "swr";
import { ApiError, fetcher, POLL_MS, type ProgressItem, type ProgressResponse } from "@/lib/client";
import { dateTimeText, percent, timeAgo } from "@/lib/format";
import { isReady, ProgressRow, useNow } from "./progress-row";
import { AccountBadge, Button, Card, Empty, ErrorBox, Segmented, Skeleton, Thumb } from "./ui";
import { useSync } from "./use-sync";

type Filter = "active" | "claimed" | "all";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "active", label: "Активные" },
  { value: "claimed", label: "Получено" },
  { value: "all", label: "Все" },
];
const ORDER = { in_progress: 0, not_started: 1, unknown: 2, claimed: 3, expired: 4 } as const;

function matches(item: ProgressItem, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "claimed") return item.status === "claimed";
  return item.status === "in_progress" || item.status === "not_started" || item.status === "unknown";
}

// In-progress first (closest to done on top), then by status order.
export function sortProgress(items: ProgressItem[]) {
  const score = (i: ProgressItem) => (isReady(i) ? -1 : ORDER[i.status]);
  return [...items].sort(
    (a, b) =>
      score(a) - score(b) ||
      (percent(b.minutesWatched, b.requiredMinutes, b.status) ?? -1) - (percent(a.minutesWatched, a.requiredMinutes, a.status) ?? -1),
  );
}

export function AccountView({ id }: { id: string }) {
  const key = `/api/accounts/${id}/progress`;
  const { data, error, mutate } = useSWR<ProgressResponse>(key, fetcher, { refreshInterval: POLL_MS });
  const sync = useSync(Number(id), () => mutate());
  const [filter, setFilter] = useState<Filter>("active");
  const now = useNow();

  if (error) {
    return <ErrorBox>{error instanceof ApiError && error.status === 404 ? "Аккаунт не найден" : "Не удалось загрузить прогресс"}</ErrorBox>;
  }
  if (!data) return <Skeleton rows={4} />;

  const { account, items, live, rewards } = data;
  const shown = sortProgress(items.filter((i) => matches(i, filter)));
  const groups = new Map<string, ProgressItem[]>();
  for (const item of shown) {
    const game = item.gameName ?? "Награды каналов";
    groups.set(game, [...(groups.get(game) ?? []), item]);
  }
  const canSync = account.status === "active" || account.status === "error";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{account.displayName}</h1>
        <AccountBadge status={account.status} />
        <span className="text-sm text-mut">обновлено {timeAgo(account.lastSyncedAt, now)}</span>
        {canSync && (
          <Button className="ml-auto" onClick={sync.run} disabled={sync.busy}>
            {sync.busy ? "Обновляем…" : "Обновить"}
          </Button>
        )}
      </div>
      {sync.error && <ErrorBox>{sync.error}</ErrorBox>}
      {account.status === "expired" && (
        <ErrorBox>Доступ к Twitch истёк, данные не обновляются. Переподключите аккаунт на странице «Аккаунты».</ErrorBox>
      )}

      <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Фильтр" />

      {groups.size === 0 ? (
        <Empty>{items.length ? "Ничего не подходит под фильтр." : "Данных пока нет. Нажмите «Обновить» или дождитесь синхронизации."}</Empty>
      ) : (
        [...groups].map(([game, list]) => (
          <Card key={game}>
            <h2 className="text-sm font-semibold text-mut">{game}</h2>
            <div className="divide-y divide-line">
              {list.map((item) => (
                <ProgressRow
                  key={item.campaignId}
                  item={item}
                  now={now}
                  channels={item.campaignExternalId ? live[item.campaignExternalId] : undefined}
                />
              ))}
            </div>
          </Card>
        ))
      )}

      {rewards.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Полученные награды · {rewards.length}</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rewards.map((r) => (
              <li key={`${r.name}-${r.awardedAt}`} className="flex items-center gap-3">
                <Thumb src={r.imageUrl} alt={r.name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-mut">{dateTimeText(r.awardedAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
