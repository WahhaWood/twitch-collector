"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import useSWR from "swr";
import { type Account, api, fetcher, POLL_MS, type StatsResponse, type StreaksResponse, viewerTimeZone } from "@/lib/client";
import { timeAgo } from "@/lib/format";
import { workerLine } from "@/lib/worker-text";
import { ConnectTwitch } from "./connect-twitch";
import { useNow } from "./progress-row";
import { AccountBadge, Button, Card, Empty, ErrorBox, Notice, Skeleton, Switch } from "./ui";
import { useSync } from "./use-sync";
import { WatchLogin } from "./watch-login";

const MAX_ACCOUNTS = 5;
const TONE_FG = { ok: "text-ok", idle: "text-mut", warn: "text-warn", bad: "text-bad", off: "text-mut" } as const;
const TONE_DOT = { ok: "bg-ok", idle: "bg-mut", warn: "bg-warn", bad: "bg-bad", off: "border border-mut" } as const;

export function AccountsView() {
  const { data, error, mutate } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher, { refreshInterval: 20_000 });
  const stats = useSWR<StatsResponse>(data?.accounts.length ? `/api/stats?days=7&tz=${encodeURIComponent(viewerTimeZone())}` : null, fetcher, { refreshInterval: POLL_MS });
  const streaks = useSWR<StreaksResponse>(data?.accounts.length ? "/api/streaks" : null, fetcher, { refreshInterval: POLL_MS });
  const refresh = useCallback(() => mutate(), [mutate]);
  const now = useNow();

  if (error) return <ErrorBox>Не удалось загрузить аккаунты</ErrorBox>;
  if (!data) return <Skeleton />;

  const accounts = data.accounts.filter((a) => a.status !== "revoked");
  return (
    <div className="flex flex-col gap-4">
      {accounts.length === 0 ? (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Начните с подключения аккаунта</h2>
          <ol className="list-decimal pl-5 text-sm text-mut">
            <li>Нажмите «Подключить Twitch» — вы получите короткий код.</li>
            <li>Откройте twitch.tv/activate, войдите в свой аккаунт и введите код.</li>
            <li>Через несколько секунд аккаунт появится здесь, а на главной — его дропсы и сроки.</li>
          </ol>
          <ConnectTwitch onConnected={refresh} />
        </Card>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <ConnectTwitch disabled={accounts.length >= MAX_ACCOUNTS} onConnected={refresh} />
          <span className="text-sm text-mut">
            Подключено {accounts.length} из {MAX_ACCOUNTS}. Чтобы переподключить аккаунт, подключите его заново тем же логином.
          </span>
        </div>
      )}
      {data.accounts.length === 0 && <Empty>Пока нет подключённых аккаунтов.</Empty>}
      {accounts.map((a) => (
        <AccountCard
          key={a.id}
          account={a}
          now={now}
          counts={stats.data?.byAccount.find((x) => x.id === a.id)}
          hasStreaks={!!streaks.data?.channels.some((c) => c.accountId === a.id)}
          onChange={refresh}
        />
      ))}
    </div>
  );
}

function AccountCard({ account, now, counts, hasStreaks, onChange }: {
  account: Account;
  now: number;
  counts?: StatsResponse["byAccount"][number];
  hasStreaks: boolean;
  onChange: () => unknown;
}) {
  const sync = useSync(account.id, onChange);
  const [removing, setRemoving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const canSync = account.status === "active" || account.status === "error";
  const line = workerLine(account, now, hasStreaks);

  async function setAutoWatch(autoWatch: boolean) {
    setToggling(true);
    try {
      await api(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoWatch }),
      });
    } finally {
      setToggling(false);
      await onChange();
    }
  }

  async function disconnect() {
    if (!confirm(`Отключить ${account.displayName}? Токены будут удалены, история прогресса останется.`)) return;
    setRemoving(true);
    try {
      await api(`/api/accounts/${account.id}`, { method: "DELETE" });
    } finally {
      setRemoving(false);
      await onChange();
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/accounts/${account.id}`} className="text-lg font-semibold hover:text-acc-t">
          {account.displayName}
        </Link>
        <span className="text-sm text-mut">@{account.login}</span>
        <AccountBadge status={account.status} />
        <span className="ml-auto text-xs text-mut">данные обновлены {timeAgo(account.lastSyncedAt, now)}</span>
      </div>

      {account.status === "expired" && (
        <Notice tone="warn" title="Доступ к аккаунту истёк">
          Twitch больше не принимает сохранённый вход. Нажмите «Подключить Twitch» выше и войдите в этот же аккаунт ещё раз — прогресс сохранится.
        </Notice>
      )}

      {counts && (
        <div className="grid grid-cols-3 gap-2 text-center sm:max-w-md">
          {[
            { v: counts.ready, label: "готово к получению", fg: counts.ready ? "text-acc-t" : "" },
            { v: counts.inProgress, label: "в процессе" },
            { v: counts.claimed, label: "получено" },
          ].map((x) => (
            <div key={x.label} className="rounded-lg bg-sf2 px-2 py-2">
              <div className={`text-xl font-medium ${x.fg ?? ""}`}>{x.v}</div>
              <div className="text-[11px] leading-tight text-mut">{x.label}</div>
            </div>
          ))}
        </div>
      )}

      {canSync && (
        <div className="flex flex-col gap-3 rounded-lg bg-sf2 p-3">
          <div className="flex items-start gap-3">
            <Switch checked={account.autoWatch} busy={toggling} onChange={setAutoWatch} label={`Автопросмотр для ${account.displayName}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Автопросмотр дропсов</div>
              <p className="text-xs text-mut">
                Воркер сам открывает стримы самых срочных кампаний, набирает минуты и забирает готовые награды. Это неофициальный способ — Twitch может
                ограничить аккаунт.
              </p>
            </div>
          </div>
          <WatchLogin account={account} onChange={onChange} />
          <div className="flex items-start gap-2 border-t border-line pt-3 text-sm">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE_DOT[line.tone]}`} aria-hidden />
            <div className="min-w-0">
              <div className={`font-medium ${TONE_FG[line.tone]}`}>{line.title}</div>
              {line.detail && <p className="text-xs text-mut">{line.detail}</p>}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Link href={`/accounts/${account.id}`} className="inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-fg/7">
          Награды аккаунта
        </Link>
        {canSync && (
          <Button onClick={sync.run} disabled={sync.busy} title="Заново спросить у Twitch прогресс и забрать готовые награды">
            {sync.busy ? "Обновляем…" : "Обновить сейчас"}
          </Button>
        )}
        <Button variant="danger" onClick={disconnect} disabled={removing} className="sm:ml-auto">
          Отключить
        </Button>
      </div>
      {sync.error && <ErrorBox>{sync.error}</ErrorBox>}
    </Card>
  );
}
