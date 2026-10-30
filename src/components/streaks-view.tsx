"use client";

import { type FormEvent, useState } from "react";
import useSWR from "swr";
import { api, ApiError, fetcher, type StreakChannel, type StreaksResponse, workerUp } from "@/lib/client";
import { errorText, timeAgo } from "@/lib/format";
import { useNow } from "./progress-row";
import { Button, Card, Empty, ErrorBox, Notice, PageHead, Pill, Skeleton, Thumb } from "./ui";

const INPUT = "rounded-lg border border-line bg-sf px-3 py-2 text-sm";
const STREAK_POLL_MS = 20_000;

export function StreaksView() {
  const { data, error, mutate } = useSWR<StreaksResponse>("/api/streaks", fetcher, { refreshInterval: STREAK_POLL_MS });
  const now = useNow();

  const head = (
    <PageHead title="Серии просмотра">
      Список стримеров, чьи эфиры воркер будет смотреть сам, чтобы не терялась серия просмотра. Работает отдельно от дропсов.
    </PageHead>
  );
  if (error) return <ErrorBox>Не удалось загрузить серии просмотра</ErrorBox>;
  if (!data) return <><div>{head}</div><Skeleton /></>;
  if (!data.accounts.length) {
    return (
      <>
        {head}
        <Empty>Сначала подключите Twitch-аккаунт на странице «Аккаунты».</Empty>
      </>
    );
  }

  const goal = Math.round(data.goalSeconds / 60);
  return (
    <div className="flex flex-col gap-4">
      {head}
      <details className="rounded-lg border border-line px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Что такое серия просмотра и как это работает</summary>
        <div className="mt-2 flex flex-col gap-2 text-mut">
          <p>
            Twitch считает, сколько эфиров подряд вы смотрели у одного стримера. Чтобы серия шла, нужно побывать на его трансляции — достаточно
            открыть её на несколько минут.
          </p>
          <p>
            Добавьте стримера ниже. Когда он выйдет в эфир, воркер откроет трансляцию и посмотрит {goal} минут, а затем освободит место для дропсов.
            Эфир должен идти от 10 минут, а с прошлого эфира должно пройти больше 30 минут.
          </p>
          <p>Twitch не сообщает, засчитал ли он серию. «Засчитано» здесь значит только одно: мы досмотрели нужное время.</p>
        </div>
      </details>
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
  const up = workerUp(account, now);

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
      </div>
      {channels.length > 0 && !up && (
        <Notice tone="warn" title="Воркер не запущен">
          Пока он выключен, серии не набираются: стримеры ниже будут ждать запуска.
        </Notice>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="Логин, напр. shroud"
          aria-label="Логин стримера"
          className={`${INPUT} min-w-0 flex-1 sm:max-w-80`}
        />
        <Button type="submit" variant="primary" disabled={busy || !login.trim()}>
          Добавить
        </Button>
      </form>
      {err && <ErrorBox>{err}</ErrorBox>}
      {channels.length === 0 ? (
        <p className="text-sm text-mut">Пока никого. Вставьте логин стримера выше — например, того, чьи эфиры вы смотрите регулярно.</p>
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
    return <Pill tone="bg-ok-bg text-ok">досмотрено</Pill>;
  }
  if (channel.live) {
    return (
      <Pill tone="bg-acc-bg text-acc-t">
        {minutes} из {goal} мин
      </Pill>
    );
  }
  return <Pill tone="bg-sf2 text-mut">ждём эфир</Pill>;
}
