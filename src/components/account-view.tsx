"use client";

import { useState } from "react";
import useSWR from "swr";
import { ApiError, fetcher, POLL_MS, type ProgressItem, type ProgressResponse } from "@/lib/client";
import { dateTimeText, percent, timeAgo } from "@/lib/format";
import { isReady, ProgressRow, useNow } from "./progress-row";
import { AccountBadge, Button, Card, Empty, ErrorBox, Notice, Segmented, Skeleton, Thumb } from "./ui";
import { useSync } from "./use-sync";

type Filter = "active" | "claimed" | "all";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "active", label: "Что ещё можно получить" },
  { value: "claimed", label: "Уже получено" },
  { value: "all", label: "Всё" },
];
const ORDER = { in_progress: 0, not_started: 1, unknown: 2, claimed: 3, expired: 4 } as const;

// Every item lands in exactly one section, so a long list reads as "what to do" instead of one wall of rows.
type Bucket = "ready" | "progress" | "waiting" | "link" | "claimed" | "expired";
export function bucketOf(i: ProgressItem): Bucket {
  if (i.status === "claimed") return "claimed";
  if (i.status === "expired") return "expired";
  if (isReady(i)) return "ready";
  if (i.status === "in_progress") return "progress";
  return i.accountConnected === false ? "link" : "waiting";
}

const SECTIONS: { bucket: Bucket; title: string; hint: string; open: boolean; filters: Filter[] }[] = [
  { bucket: "ready", title: "Можно забрать", hint: "Время набрано. Нажмите «Обновить сейчас» — сервис заберёт награды сам. Если у награды предупреждение о привязке, сначала привяжите аккаунт игры.", open: true, filters: ["active", "all"] },
  { bucket: "progress", title: "Начаты", hint: "Часть минут уже набрана. Прирост идёт, только пока вы или воркер смотрите стрим этой игры (см. статус воркера выше).", open: true, filters: ["active", "all"] },
  { bucket: "waiting", title: "Ещё не начаты", hint: "Начнут набираться, когда вы или воркер посмотрите стрим этой игры.", open: false, filters: ["active", "all"] },
  { bucket: "link", title: "Не начаты, нужна привязка аккаунта игры", hint: "Пока аккаунт игры не привязан к Twitch, награды не выдаются, а воркер эти кампании пропускает.", open: false, filters: ["active", "all"] },
  { bucket: "claimed", title: "Получено", hint: "", open: true, filters: ["claimed", "all"] },
  { bucket: "expired", title: "Не успели: кампания закончилась", hint: "", open: false, filters: ["all"] },
];

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
  const canSync = account.status === "active" || account.status === "error";
  const count = (b: Bucket) => items.filter((i) => bucketOf(i) === b).length;
  const sections = SECTIONS.filter((x) => x.filters.includes(filter))
    .map((x) => ({ ...x, list: sortProgress(items.filter((i) => bucketOf(i) === x.bucket)) }))
    .filter((x) => x.list.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{account.displayName}</h1>
        <AccountBadge status={account.status} />
        <span className="text-sm text-mut">данные обновлены {timeAgo(account.lastSyncedAt, now)}</span>
        {canSync && (
          <Button className="ml-auto" onClick={sync.run} disabled={sync.busy} title="Заново спросить у Twitch прогресс и забрать готовые награды">
            {sync.busy ? "Обновляем…" : "Обновить сейчас"}
          </Button>
        )}
      </div>
      {sync.error && <ErrorBox>{sync.error}</ErrorBox>}
      {account.status === "expired" && (
        <Notice tone="warn" title="Доступ к Twitch истёк, данные не обновляются">
          Переподключите аккаунт на странице «Аккаунты»: прогресс сохранится.
        </Notice>
      )}

      <p className="text-sm text-mut">
        {count("ready")} можно забрать · {count("progress")} начато · {count("waiting")} не начато · {count("link")} ждут привязки · {count("claimed")} получено
      </p>

      <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Что показать" />

      {sections.length === 0 ? (
        <Empty>{items.length ? "В этой части пусто." : "Данных пока нет. Нажмите «Обновить сейчас» или дождитесь автоматической синхронизации."}</Empty>
      ) : (
        sections.map((sec) => {
          const groups = new Map<string, ProgressItem[]>();
          for (const item of sec.list) groups.set(item.gameName ?? "Награды каналов", [...(groups.get(item.gameName ?? "Награды каналов") ?? []), item]);
          return (
            <details key={sec.bucket} open={sec.open} className="group flex flex-col gap-3">
              <summary className="flex cursor-pointer list-none items-baseline gap-2">
                <span className="text-mut transition-transform group-open:rotate-90" aria-hidden>
                  ›
                </span>
                <h2 className="text-lg font-semibold">{sec.title}</h2>
                <span className="text-sm text-mut">{sec.list.length}</span>
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                {sec.hint && <p className="text-sm text-mut">{sec.hint}</p>}
                {[...groups].map(([game, list]) => (
                  <Card key={game}>
                    <h3 className="text-sm font-semibold text-mut">
                      {game} · {list.length}
                    </h3>
                    <div className="divide-y divide-line">
                      {list.map((item) => (
                        <ProgressRow key={item.campaignId} item={item} now={now} channels={item.campaignExternalId ? live[item.campaignExternalId] : undefined} />
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </details>
          );
        })
      )}

      {rewards.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">История полученных наград · {rewards.length}</h2>
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
