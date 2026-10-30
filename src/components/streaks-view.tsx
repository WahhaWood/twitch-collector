"use client";

import { type FormEvent, useState } from "react";
import useSWR from "swr";
import { api, ApiError, fetcher, type StreakChannel, type StreaksResponse, WORKER_STALE_MS } from "@/lib/client";
import { errorText, timeAgo } from "@/lib/format";
import { useNow } from "./progress-row";
import { Button, Card, Empty, ErrorBox, Pill, Skeleton, Thumb } from "./ui";

const INPUT = "rounded-lg border border-line bg-sf px-3 py-2 text-sm";
const STREAK_POLL_MS = 20_000;

export function StreaksView() {
  const { data, error, mutate } = useSWR<StreaksResponse>("/api/streaks", fetcher, { refreshInterval: STREAK_POLL_MS });
  const now = useNow();

  if (error) return <ErrorBox>Не удалось загрузить стрики</ErrorBox>;
  if (!data) return <Skeleton />;
  if (!data.accounts.length) return <Empty>Сначала подключите Twitch-аккаунт на странице «Аккаунты».</Empty>;

  const goal = Math.round(data.goalSeconds / 60);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-mut">
        Когда выбранный стример в эфире, воркер смотрит его трансляцию {goal} минут, чтобы засчитался стрик. Twitch засчитывает его, если эфир
        длится от 10 минут и с прошлого эфира прошло больше 30 минут. Подтверждения от Twitch нет: «засчитано» значит, что мы досмотрели нужное время.
      </p>
      {data.accounts.map((a) => (
        <AccountStreaks
          key={a.id}
          account={a}
          channels={data.channels.filter((c) => c.accountId === a.id)}
          goalSeconds={data.goalSeconds}
          now={now}
          onChange={() => mutate()}
        />
      ))}
    </div>
  );
}

function AccountStreaks({ account, channels, goalSeconds, now, onChange }: {
  account: StreaksResponse["accounts"][number];
  channels: StreakChannel[];
  goalSeconds: number;
  now: number;
  onChange: () => unknown;
}) {
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const workerUp = !!account.watchingAt && now - new Date(account.watchingAt).getTime() < WORKER_STALE_MS;

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/streaks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: account.id, login: login.replace(/^.*twitch\.tv\//, "").replace(/^@/, "") }),
      });
      setLogin("");
    } catch (e) {
      setErr(e instanceof ApiError ? errorText(e.code, "Не удалось добавить") : "Не удалось добавить");
    } finally {
      setBusy(false);
      await onChange();
    }
  }

  async function remove(c: StreakChannel) {
    await api(`/api/streaks/${c.id}`, { method: "DELETE" }).catch(() => null);
    await onChange();
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{account.displayName}</h2>
        {channels.length > 0 && !workerUp && <span className="text-xs text-warn">воркер не запущен</span>}
      </div>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="Логин стримера"
          aria-label="Логин стримера"
          className={`${INPUT} min-w-0 flex-1 sm:max-w-64`}
        />
        <Button type="submit" variant="primary" disabled={busy || !login.trim()}>
          Добавить
        </Button>
      </form>
      {err && <ErrorBox>{err}</ErrorBox>}
      {channels.length === 0 ? (
        <p className="text-sm text-mut">Пока никого. Добавьте стримеров, чей стрик нужно поддерживать.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {channels.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <Thumb src={c.avatarUrl} alt="" size="sm" />
              <div className="flex min-w-0 flex-1 flex-col">
                <a href={`https://www.twitch.tv/${c.login}`} target="_blank" rel="noreferrer" className="truncate font-medium hover:text-acc-t">
                  {c.displayName}
                </a>
                <span className="text-xs text-mut">
                  {c.live && c.liveSince ? `в эфире с ${new Date(c.liveSince).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}` : "не в эфире"}
                  {c.checkedAt && ` · проверено ${timeAgo(c.checkedAt, now)}`}
                </span>
              </div>
              <StreakState channel={c} goalSeconds={goalSeconds} />
              <Button variant="danger" onClick={() => remove(c)} aria-label={`Убрать ${c.displayName}`}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StreakState({ channel, goalSeconds }: { channel: StreakChannel; goalSeconds: number }) {
  const minutes = Math.floor(channel.watchedSeconds / 60);
  const goal = Math.round(goalSeconds / 60);
  if (channel.watchedSeconds >= goalSeconds) {
    return <Pill tone="bg-ok-bg text-ok">засчитано</Pill>;
  }
  if (channel.live) {
    return (
      <Pill tone="bg-acc-bg text-acc-t">
        {minutes}/{goal} мин
      </Pill>
    );
  }
  return <Pill tone="bg-sf2 text-mut">ждём эфир</Pill>;
}
