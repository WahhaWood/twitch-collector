"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import useSWR from "swr";
import { type Account, api, fetcher, POLL_MS, WORKER_STALE_MS } from "@/lib/client";
import { timeAgo } from "@/lib/format";
import { ConnectTwitch } from "./connect-twitch";
import { useNow } from "./progress-row";
import { AccountBadge, Button, Card, Empty, ErrorBox, Skeleton } from "./ui";
import { useSync } from "./use-sync";

const MAX_ACCOUNTS = 5;

export function AccountsView() {
  const { data, error, mutate } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher, { refreshInterval: POLL_MS });
  const refresh = useCallback(() => mutate(), [mutate]);
  const now = useNow();

  if (error) return <ErrorBox>Не удалось загрузить аккаунты</ErrorBox>;
  if (!data) return <Skeleton />;

  const connected = data.accounts.filter((a) => a.status !== "revoked").length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-mut">
          Подключено {connected} из {MAX_ACCOUNTS}. Чтобы переподключить аккаунт, подключите его заново тем же Twitch-логином.
        </p>
        <ConnectTwitch disabled={connected >= MAX_ACCOUNTS} onConnected={refresh} />
      </div>
      {data.accounts.length === 0 ? (
        <Empty>Пока нет подключённых аккаунтов.</Empty>
      ) : (
        data.accounts.map((a) => <AccountCard key={a.id} account={a} now={now} onChange={refresh} />)
      )}
    </div>
  );
}

function AccountCard({ account, now, onChange }: { account: Account; now: number; onChange: () => unknown }) {
  const sync = useSync(account.id, onChange);
  const [removing, setRemoving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const canSync = account.status === "active" || account.status === "error";
  const workerUp = !!account.watchingAt && now - new Date(account.watchingAt).getTime() < WORKER_STALE_MS;

  async function toggleWatch() {
    setToggling(true);
    try {
      await api(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoWatch: !account.autoWatch }),
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
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/accounts/${account.id}`} className="font-semibold hover:text-acc-t">
          {account.displayName}
        </Link>
        <span className="text-sm text-mut">@{account.login}</span>
        <AccountBadge status={account.status} />
        <span className="ml-auto text-xs text-mut">обновлено {timeAgo(account.lastSyncedAt, now)}</span>
      </div>
      {account.status === "expired" && (
        <p className="text-sm text-warn">Доступ истёк. Нажмите «Подключить Twitch» и войдите в этот аккаунт снова.</p>
      )}
      {canSync && (
        <div className="flex flex-col gap-1 rounded-lg bg-sf2 p-3 text-sm">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" className="size-4 accent-violet-600" checked={account.autoWatch} disabled={toggling} onChange={toggleWatch} />
            Автопросмотр дропсов
          </label>
          <p className="text-xs text-mut">
            Воркер смотрит каналы самых срочных кампаний и сам забирает досмотренные награды.
            {account.autoWatch && !workerUp && " Воркер сейчас не запущен: npm run worker."}
          </p>
          {workerUp && account.watching?.length ? (
            <ul className="text-xs text-mut">
              {account.watching.map((w) => (
                <li key={w.login}>
                  Смотрит{" "}
                  <a href={`https://www.twitch.tv/${w.login}`} target="_blank" rel="noreferrer" className="font-medium text-acc-t hover:underline">
                    {w.displayName}
                  </a>{" "}
                  — {w.kind === "drop" ? `дропсы: ${w.campaignName ?? "кампания"}` : "стрик"}
                </li>
              ))}
            </ul>
          ) : (
            workerUp && <p className="text-xs text-mut">Воркер работает, подходящих live-каналов сейчас нет.</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/accounts/${account.id}`}
          className="inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-sf2"
        >
          Прогресс
        </Link>
        {canSync && (
          <Button onClick={sync.run} disabled={sync.busy}>
            {sync.busy ? "Обновляем…" : "Обновить"}
          </Button>
        )}
        {account.status !== "revoked" && (
          <Button variant="danger" onClick={disconnect} disabled={removing}>
            Отключить
          </Button>
        )}
      </div>
      {sync.error && <ErrorBox>{sync.error}</ErrorBox>}
    </Card>
  );
}
