"use client";

import Link from "next/link";
import { useCallback } from "react";
import useSWR from "swr";
import {
  type Account,
  api,
  fetcher,
  type PlanItem,
  type PlanResponse,
  POLL_MS,
  type ProgressItem,
  type ProgressResponse,
  type Risk,
  type StatsResponse,
  type StreaksResponse,
  viewerTimeZone,
} from "@/lib/client";
import { durationText, hoursText, plural, SUB_HINT, timeAgo, timeLeft } from "@/lib/format";
import { channelHue, greeting, leftShort, segments, timelineBar, WINDOW_MIN } from "@/lib/overview";
import { workerLine, type WorkerLine } from "@/lib/worker-text";
import { sortProgress } from "./account-view";
import { ConnectTwitch } from "./connect-twitch";
import { isReady, useNow } from "./progress-row";
import { AccountBadge, Card, Empty, ErrorBox, Notice, Skeleton, StatusDot } from "./ui";
import { useSync } from "./use-sync";

const MIN = 60_000;
const LINKS_SHOWN = 6;

const RISK: Record<Risk, { label: string; fg: string; bg: string }> = {
  ok: { label: "успеваете", fg: "text-ok", bg: "bg-ok" },
  tight: { label: "впритык", fg: "text-warn", bg: "bg-warn" },
  impossible: { label: "не успеть", fg: "text-bad", bg: "bg-bad" },
};

const kicker = "text-[11px] tracking-[.1em] text-mut uppercase";
const secondary = "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-line px-3.5 text-sm font-medium hover:bg-fg/7 md:min-h-0 md:py-2";
const primary = "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-acc px-3.5 text-sm font-medium text-acc-t hover:bg-acc/12 disabled:opacity-45 md:min-h-0 md:py-2";

type Progress = Record<number, ProgressItem[]>;

export function Dashboard({ name }: { name: string }) {
  const now = useNow();
  const { data, error, mutate: mutateAccounts } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher, { refreshInterval: 20_000 });
  const accounts = data?.accounts.filter((a) => a.status !== "revoked");
  const ids = accounts?.map((a) => a.id) ?? [];
  const progress = useSWR<Progress>(ids.length ? ["progress", ...ids] : null, () => loadProgress(ids), { refreshInterval: POLL_MS });
  const plan = useSWR<PlanResponse>(accounts?.length ? "/api/plan" : null, fetcher, { refreshInterval: POLL_MS });
  const stats = useSWR<StatsResponse>(accounts?.length && now ? `/api/stats?days=7&tz=${encodeURIComponent(viewerTimeZone())}` : null, fetcher, {
    refreshInterval: POLL_MS,
  });
  const streaks = useSWR<StreaksResponse>(accounts?.length ? "/api/streaks" : null, fetcher, { refreshInterval: POLL_MS });

  const refresh = useCallback(
    () => Promise.all([mutateAccounts(), progress.mutate(), plan.mutate(), stats.mutate()]),
    [mutateAccounts, progress, plan, stats],
  );
  const hello = `${now ? greeting(new Date(now).getHours()) : "Здравствуйте"}, ${name}`;

  if (error) return <ErrorBox>Не удалось загрузить аккаунты</ErrorBox>;
  if (!accounts) return <Skeleton />;
  if (!accounts.length) return <Onboarding hello={hello} onConnected={() => mutateAccounts()} />;

  const hasStreaks = (a: Account) => !!streaks.data?.channels.some((c) => c.accountId === a.id);
  const lines = accounts.filter((a) => a.status === "active" || a.status === "error").map((a) => ({ account: a, line: workerLine(a, now, hasStreaks(a)) }));
  const watching = accounts.flatMap((a) => (workerLine(a, now, hasStreaks(a)).tone === "ok" ? (a.watching ?? []).map((w) => ({ ...w, account: a })) : []));
  const t = stats.data?.totals;
  const totals = t && [
    { v: String(t.ready), label: "готово к получению", fg: t.ready ? "text-acc-t" : "" },
    { v: String(t.inProgress), label: "начато" },
    { v: String(t.claimed), label: "уже получено" },
    { v: hoursText(t.remainingMinutes), label: "смотреть до конца всех кампаний" },
  ];

  return (
    <div className="flex flex-col gap-[26px] md:gap-9">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8">
        <h1 className="text-[22px] font-medium tracking-[-.015em] md:text-[28px]">{hello}</h1>
        {totals && (
          <div className="grid grid-cols-4 gap-2 md:flex md:gap-9">
            {totals.map((x) => (
              <div key={x.label} className="min-w-0 md:max-w-36">
                <div className={`text-xl leading-none font-medium md:text-[26px] ${x.fg}`}>{x.v}</div>
                <div className="mt-1 text-[11px] leading-tight text-mut md:mt-[5px] md:text-xs">{x.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Status lines={lines} />

      <ToDo accounts={accounts} plan={plan.data} progress={progress.data} onDone={refresh} />

      {watching.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className={kicker}>Сейчас смотрит воркер</h2>
          <div className="grid gap-[18px] md:grid-cols-2 md:gap-10">
            {watching.map((w) => (
              <NowWatching key={`${w.account.id}:${w.login}`} {...w} progress={progress.data} streaks={streaks.data} />
            ))}
          </div>
        </section>
      )}

      {plan.error ? <ErrorBox>Не удалось составить план</ErrorBox> : plan.data ? <Timeline plan={plan.data} now={now} onChange={() => plan.mutate()} /> : <Skeleton rows={2} />}

      <Accounts accounts={accounts} progress={progress.data} now={now} />
    </div>
  );
}

async function loadProgress(ids: number[]): Promise<Progress> {
  const all = await Promise.all(ids.map((id) => fetcher<ProgressResponse>(`/api/accounts/${id}/progress`)));
  return Object.fromEntries(all.map((r) => [r.account.id, r.items]));
}

function Onboarding({ hello, onConnected }: { hello: string; onConnected: () => void }) {
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-[22px] font-medium tracking-[-.015em] sm:text-[28px]">{hello}</h1>
      <p className="text-sm text-mut">
        Этот сервис следит за наградами Twitch (дропсами и значками), показывает, что успеть до конца акций, и может сам смотреть стримы ради наград.
        Чтобы начать, подключите свой Twitch-аккаунт.
      </p>
      <ol className="flex flex-col gap-2 text-sm">
        {[
          ["Подключите аккаунт", "кнопка ниже — получите короткий код и введите его на twitch.tv/activate."],
          ["Посмотрите, что можно забрать", "на этой странице появятся награды и сроки."],
          ["По желанию включите автопросмотр", "на странице «Аккаунты»: воркер будет смотреть стримы за вас."],
        ].map(([title, text], i) => (
          <li key={title} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-acc text-xs text-acc-t">{i + 1}</span>
            <span>
              <b className="font-medium">{title}</b> <span className="text-mut">— {text}</span>
            </span>
          </li>
        ))}
      </ol>
      <ConnectTwitch onConnected={onConnected} />
      <Link href="/help" className="self-start text-sm text-acc-t underline">
        Как всё устроено подробнее
      </Link>
    </div>
  );
}

// One verdict for the whole service, most serious problem first.
function Status({ lines }: { lines: { account: Account; line: WorkerLine }[] }) {
  const tone = (t: WorkerLine["tone"]) => lines.filter((l) => l.line.tone === t);
  const names = (ls: typeof lines) => ls.map((l) => l.account.displayName).join(", ");
  const manage = (
    <Link href="/accounts" className={secondary}>
      Аккаунты
    </Link>
  );
  if (!lines.length) return null;
  if (tone("bad").length) {
    const l = tone("bad")[0];
    return (
      <Notice tone="bad" title={`${l.line.title} · ${names(tone("bad"))}`} action={manage}>
        {l.line.detail}
      </Notice>
    );
  }
  if (tone("warn").length) {
    return (
      <Notice
        tone="warn"
        title="Воркер не запущен — просмотр стоит"
        action={
          <Link href="/help" className={secondary}>
            Что это значит
          </Link>
        }
      >
        Автопросмотр включён для: {names(tone("warn"))}, но программа-воркер не отвечает. Пока она не запущена, минуты не набираются.
      </Notice>
    );
  }
  if (tone("ok").length) {
    return (
      <Notice tone="ok" title={`Всё работает: стримы смотрят ${tone("ok").length} ${plural(tone("ok").length, "аккаунт", "аккаунта", "аккаунтов")}`}>
        {tone("ok").map((l) => l.line.title).join(" · ")}
      </Notice>
    );
  }
  if (tone("idle").length) {
    const l = tone("idle")[0];
    return (
      <Notice tone="info" title={l.line.title} action={manage}>
        {l.line.detail}
      </Notice>
    );
  }
  return (
    <Notice
      tone="info"
      title="Автопросмотр выключен — сервис только показывает прогресс"
      action={
        <Link href="/accounts" className={primary}>
          Включить автопросмотр
        </Link>
      }
    >
      Чтобы стримы смотрел воркер, включите переключатель «Автопросмотр» у аккаунта. Либо смотрите стримы сами — прогресс обновится на этой странице.
    </Notice>
  );
}

// What needs a person: collect rewards, link game accounts, reconnect accounts.
function ToDo({ accounts, plan, progress, onDone }: { accounts: Account[]; plan?: PlanResponse; progress?: Progress; onDone: () => unknown }) {
  const claims = accounts
    .map((account) => ({ account, items: (progress?.[account.id] ?? []).filter((i) => isReady(i) && i.accountConnected !== false) }))
    .filter((c) => c.items.length);
  const blocked = accounts.flatMap((account) =>
    (progress?.[account.id] ?? []).filter((i) => isReady(i) && i.accountConnected === false).map((item) => ({ item, account })),
  );
  const expired = accounts.filter((a) => a.status === "expired");
  const links = (plan?.accounts ?? []).flatMap((a) => a.items.filter((i) => i.action === "link").map((i) => ({ ...i, accountName: a.displayName })));
  const byGame = new Map<string, typeof links>();
  for (const l of links) byGame.set(l.gameName ?? "Другое", [...(byGame.get(l.gameName ?? "Другое") ?? []), l]);
  const nothing = !claims.length && !blocked.length && !expired.length && !links.length;

  return (
    <section className="flex flex-col gap-2">
      <h2 className={kicker}>Что нужно сделать вам</h2>
      {nothing && <p className="text-sm text-mut">{progress ? "Сейчас от вас ничего не требуется. Всё, что можно, делается автоматически." : "Проверяем…"}</p>}
      {expired.map((a) => (
        <Row key={`e${a.id}`} icon="!" title={`Переподключите аккаунт ${a.displayName}`} sub="Twitch отозвал доступ: данные не обновляются.">
          <Link href="/accounts" className={primary}>
            Переподключить
          </Link>
        </Row>
      ))}
      {claims.map(({ account, items }) => (
        <Row
          key={`c${account.id}`}
          thumb={items[0].imageUrl}
          title={`${items.length} ${plural(items.length, "награда готова", "награды готовы", "наград готово")} к получению`}
          sub={`${items.map((i) => i.name).slice(0, 3).join(", ")}${items.length > 3 ? "…" : ""} · ${account.displayName}`}
        >
          <ClaimButton accountId={account.id} onDone={onDone} />
        </Row>
      ))}
      {blocked.map(({ item, account }) => (
        <Row key={`b${account.id}:${item.campaignId}`} icon="↯" title={`«${item.name}» набрана, но награду не выдадут`} sub={`${account.displayName} · привяжите аккаунт игры к Twitch`}>
          {item.accountLinkUrl && (
            <a className={primary} href={item.accountLinkUrl} target="_blank" rel="noreferrer">
              Привязать ↗
            </a>
          )}
        </Row>
      ))}
      {links.length > 0 && (
        <details className="group rounded-lg border border-line">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 md:px-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-sf2 text-mut">
              <LinkIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px]">
                Привяжите аккаунты игр: {links.length} {plural(links.length, "кампания", "кампании", "кампаний")}
              </span>
              <span className="block text-xs text-mut">Без привязки Twitch не выдаст награды, поэтому воркер эти кампании не смотрит. Нажмите, чтобы раскрыть.</span>
            </span>
            <span className="text-mut transition-transform group-open:rotate-90" aria-hidden>
              ›
            </span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-line px-3 py-3 md:px-4">
            {[...byGame].map(([game, list]) => (
              <div key={game} className="flex min-w-0 flex-col gap-1">
                <div className="text-[13px] font-medium">{game}</div>
                {list.slice(0, LINKS_SHOWN).map((l) => (
                  <div key={`${l.accountId}:${l.key}`} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-mut">{l.campaignName}</span>
                    {l.accountLinkUrl && (
                      <a href={l.accountLinkUrl} target="_blank" rel="noreferrer" className="shrink-0 text-acc-t hover:text-fg">
                        Привязать ↗
                      </a>
                    )}
                  </div>
                ))}
                {list.length > LINKS_SHOWN && <p className="text-xs text-mut">…и ещё {list.length - LINKS_SHOWN}</p>}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="18" strokeLinecap="round" aria-hidden>
      <path d="M112 144a40 40 0 0 1 0-56l32-32a40 40 0 0 1 56 56l-16 16M144 112a40 40 0 0 1 0 56l-32 32a40 40 0 0 1-56-56l16-16" />
    </svg>
  );
}

function Row({ title, sub, thumb, icon, children }: { title: string; sub: string; thumb?: string | null; icon?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-3 md:px-4">
      {icon ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-sf2 text-mut" aria-hidden>
          {icon}
        </span>
      ) : (
        <RewardThumb src={thumb ?? null} label={title} />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[15px]">{title}</div>
        <div className="text-xs text-mut md:truncate">{sub}</div>
      </div>
      {children}
    </div>
  );
}

function Avatar({ login, avatarUrl, size }: { login: string; avatarUrl?: string | null; size: string }) {
  return (
    <div
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-avatar ${size}`}
      style={{ background: `oklch(0.52 0.11 ${channelHue(login)})`, boxShadow: "0 0 0 2px var(--bg), 0 0 0 3.5px var(--ok)" }}
      aria-hidden
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        login[0]?.toUpperCase()
      )}
    </div>
  );
}

function NowWatching({ kind, login, displayName, avatarUrl, campaignName, account, progress, streaks }: {
  kind: "drop" | "streak";
  login: string;
  displayName: string;
  avatarUrl?: string | null;
  campaignName?: string | null;
  account: Account;
  progress?: Progress;
  streaks?: StreaksResponse;
}) {
  let goal: { cur: number; max: number; label: string; eta: string } | null = null;
  if (kind === "drop") {
    const next = (progress?.[account.id] ?? [])
      .filter((i) => i.campaignName === campaignName && i.requiredMinutes && !isReady(i) && (i.status === "in_progress" || i.status === "not_started"))
      .map((i) => ({ i, left: i.requiredMinutes! - (i.minutesWatched ?? 0) }))
      .sort((a, b) => a.left - b.left)[0];
    if (next) goal = { cur: next.i.minutesWatched ?? 0, max: next.i.requiredMinutes!, label: next.i.name, eta: `до награды ещё ${durationText(next.left)}` };
  } else if (streaks) {
    const ch = streaks.channels.find((c) => c.accountId === account.id && c.login === login);
    const max = Math.round(streaks.goalSeconds / 60);
    if (ch) {
      const cur = Math.min(max, Math.floor(ch.watchedSeconds / 60));
      goal = { cur, max, label: "Серия просмотра за этот эфир", eta: cur >= max ? "досмотрено" : `ещё ${durationText(max - cur)}` };
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 md:gap-2.5">
      <div className="flex items-center gap-2.5 md:gap-3">
        <Avatar login={login} avatarUrl={avatarUrl} size="size-[30px] text-xs md:size-9 md:text-sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px]">
            <a href={`https://www.twitch.tv/${encodeURIComponent(login)}`} target="_blank" rel="noreferrer" className="font-medium hover:text-acc-t">
              {displayName}
            </a>{" "}
            <span className="text-[13px] text-mut md:text-[15px]">· {account.displayName}</span>
          </div>
          <div className="truncate text-xs text-mut md:text-[13px]">{kind === "streak" ? "Серия просмотра" : `Дропсы: ${campaignName ?? "кампания"}`}</div>
        </div>
        {goal && (
          <div className="text-2xl leading-none font-medium tracking-[-.02em] md:text-[30px]">
            {goal.cur}
            <span className="text-[15px] text-mut md:text-lg">/{goal.max}</span>
          </div>
        )}
      </div>
      {goal && (
        <>
          <div className="flex h-2 gap-[3px]" role="progressbar" aria-valuenow={goal.cur} aria-valuemax={goal.max}>
            {segments(goal.cur, goal.max).map((f, i) => (
              <div key={i} className="flex-1 rounded-[2px]" style={{ background: `linear-gradient(90deg, var(--acc) ${f * 100}%, var(--track) 0)` }} />
            ))}
          </div>
          <div className="flex justify-between gap-2 text-xs text-mut">
            <span className="truncate">{goal.label} · минуты</span>
            <span className="shrink-0 text-acc-t">{goal.eta}</span>
          </div>
        </>
      )}
    </div>
  );
}

type Row_ = PlanItem & { accountName: string };

function Timeline({ plan, now, onChange }: { plan: PlanResponse; now: number; onChange: () => unknown }) {
  const watch: Row_[] = plan.accounts.flatMap((a) => a.items.filter((i) => i.action === "watch").map((i) => ({ ...i, accountName: a.displayName })));
  const leftOf = (r: Row_) => (r.endsAt && now ? (new Date(r.endsAt).getTime() - now) / MIN : Infinity);
  const soon = watch.filter((r) => leftOf(r) <= WINDOW_MIN && r.remainingMinutes !== null).sort((a, b) => leftOf(a) - leftOf(b));
  const later = watch.filter((r) => !soon.includes(r)).sort((a, b) => leftOf(a) - leftOf(b));
  const skipped = plan.accounts.flatMap((a) => a.skipped.map((s) => ({ ...s, accountId: a.id })));
  const ticks = [0, 2, 4, 6, 8];

  return (
    <section className="flex flex-col gap-1 md:gap-1.5">
      <h2 className={kicker}>Что успеть в ближайшие 8 часов</h2>
      <p className="mb-1 text-xs text-mut">
        <span className="mr-1 inline-block h-2 w-5 rounded-[2px] bg-ok align-middle" /> сколько ещё смотреть ·{" "}
        <span className="mx-0.5 inline-block h-3 w-0.5 bg-fg align-middle" /> когда кампания закончится ·{" "}
        <span className="hatch mx-0.5 inline-block h-2 w-5 align-middle" /> то, что не успеть
      </p>
      <div className="hidden md:grid md:grid-cols-[280px_minmax(0,1fr)_190px] md:items-end md:gap-6">
        <span />
        <div className="relative h-[18px] text-[11px] text-mut">
          {ticks.map((h) => (
            <span
              key={h}
              className={`absolute bottom-0 whitespace-nowrap ${h === 0 ? "" : h === 8 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: `${(h / 8) * 100}%` }}
            >
              {h === 0 ? "сейчас" : `через ${h} ч`}
            </span>
          ))}
        </div>
      </div>
      {soon.length === 0 && (
        <p className="rule py-3.5 text-sm text-mut">
          {watch.length ? "Ни одна кампания не закончится в ближайшие 8 часов — спешить некуда." : "Сейчас нет кампаний, которые нужно смотреть."}
        </p>
      )}
      {soon.map((r) => (
        <TimelineRow key={`${r.accountId}:${r.key}`} row={r} left={leftOf(r)} onChange={onChange} />
      ))}
      {later.length > 0 && (
        <details className="pt-2 text-[13px]">
          <summary className="cursor-pointer text-mut hover:text-fg">Закончатся позже: {later.length}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {later.map((r) => (
              <li key={`${r.accountId}:${r.key}`} className="flex flex-wrap gap-x-2 text-mut">
                <span className="text-fg">{r.campaignName}</span>
                <span>{Number.isFinite(leftOf(r)) ? `закончится через ${leftShort(leftOf(r))}` : "без срока"}</span>
                {r.risk && <span className={RISK[r.risk].fg}>{RISK[r.risk].label}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {skipped.length > 0 && (
        <details className="pt-1 text-[13px]">
          <summary className="cursor-pointer text-mut hover:text-fg">Скрыто из плана: {skipped.length}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {skipped.map((s) => (
              <li key={`${s.accountId}:${s.key}`} className="flex flex-wrap items-baseline gap-x-2 text-mut">
                <span className="text-fg">{s.campaignName}</span>
                <span>
                  {s.reason === "no_progress"
                    ? `Twitch не засчитывал просмотр${s.retryAt && now ? `, повторим ${timeLeft(s.retryAt, now)?.replace("ещё ", "через ") ?? "скоро"}` : ""}`
                    : "скрыто вами"}
                </span>
                <button className="text-acc-t hover:text-fg" onClick={() => setSkipped(s.accountId, s.key, null).then(onChange)}>
                  вернуть в план
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function setSkipped(accountId: number, key: string, name: string | null) {
  return api(`/api/accounts/${accountId}/skipped`, {
    method: name ? "POST" : "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(name ? { key, name } : { key }),
  }).catch(() => undefined);
}

function TimelineRow({ row, left, onChange }: { row: Row_; left: number; onChange: () => unknown }) {
  const remaining = row.remainingMinutes ?? 0;
  const risk = RISK[row.risk ?? "ok"];
  const bar = timelineBar(remaining, left);
  const channel = row.channels[0];
  // The campaign is often named after its first reward, which may be a sub reward; name the one watching earns.
  const reward = row.next && row.next.name !== row.campaignName ? row.next.name : null;
  const subs = row.subDrops.length > 0 && (
    <div className="truncate text-xs text-mut">
      + {row.subDrops.map((d) => d.name).join(", ")} — {SUB_HINT}
    </div>
  );
  const action =
    row.risk === "impossible" ? (
      <button className={secondary} title="Убрать кампанию из плана; вернуть можно внизу блока" onClick={() => setSkipped(row.accountId, row.key, row.campaignName).then(onChange)}>
        Убрать из плана
      </button>
    ) : channel ? (
      <a className={secondary} target="_blank" rel="noreferrer" href={`https://www.twitch.tv/${encodeURIComponent(channel.login)}`} title="Открыть стрим на Twitch">
        Смотреть<span className="hidden md:inline">&nbsp;{channel.displayName}</span>
      </a>
    ) : (
      <a
        className={secondary}
        target="_blank"
        rel="noreferrer"
        href={`https://www.twitch.tv/directory/category/${encodeURIComponent(row.gameName ?? row.campaignName)}?filter=drops`}
        title="Сейчас в нашем списке нет стримов этой кампании в эфире"
      >
        Найти стрим
      </a>
    );
  const track = (
    <div className="relative h-[22px] md:h-7">
      <div className="absolute inset-x-0 top-2.5 h-0.5 bg-track md:top-[13px]" />
      <div className={`absolute top-1.5 left-0 h-2.5 rounded-[3px] md:top-2 md:h-3 ${risk.bg}`} style={{ width: bar.fit }} />
      <div className="hatch absolute top-1.5 h-2.5 rounded-r-[3px] md:top-2 md:h-3" style={{ left: bar.deadline, width: bar.over }} />
      <div className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: bar.deadline }} />
      <div className="absolute -top-0.5 hidden pl-1.5 text-[11px] whitespace-nowrap md:block" style={{ left: bar.deadline }}>
        конец через {leftShort(left)}
      </div>
    </div>
  );

  return (
    <div className="rule py-3 md:grid md:grid-cols-[280px_minmax(0,1fr)_190px] md:items-center md:gap-6 md:py-3.5">
      {/* phone */}
      <div className="flex min-w-0 flex-col gap-1.5 md:hidden">
        <div className="flex items-baseline justify-between gap-2.5">
          <span className="min-w-0 text-[15px]">{row.campaignName}</span>
          <span className={`text-xs whitespace-nowrap ${risk.fg}`}>{risk.label}</span>
        </div>
        {reward && <div className="truncate text-xs text-mut">за просмотр: {reward}</div>}
        {subs}
        {track}
        <div className="flex items-center gap-2.5">
          <span className="flex-1 text-xs text-mut">
            смотреть ещё {durationText(remaining)} · кампания закончится через {leftShort(left)}
          </span>
          {action}
        </div>
      </div>
      {/* desktop */}
      <div className="hidden min-w-0 items-center gap-3 md:flex">
        <RewardThumb src={row.next?.imageUrl ?? row.imageUrl} label={row.gameName ?? row.campaignName} />
        <div className="min-w-0">
          <div className="truncate text-[15px]">{row.campaignName}</div>
          <div className="truncate text-xs text-mut">
            {reward && <>{reward} · </>}
            {row.accountName} · смотреть ещё {durationText(remaining)} · <span className={risk.fg}>{risk.label}</span>
          </div>
          {subs}
        </div>
      </div>
      <div className="hidden md:block">{track}</div>
      <div className="hidden md:flex">{action}</div>
    </div>
  );
}

function RewardThumb({ src, label }: { src: string | null; label: string }) {
  const box = "hidden size-9 shrink-0 rounded-md bg-acc-bg md:grid";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="lazy" className={`${box} object-cover`} />;
  }
  return <div className={`${box} place-items-center text-[11px] font-semibold text-acc-t`}>{label.slice(0, 3).toUpperCase()}</div>;
}

// Sync claims every watched-out drop of the account, so "Забрать" is a manual sync.
function ClaimButton({ accountId, onDone }: { accountId: number; onDone: () => unknown }) {
  const { busy, error, run } = useSync(accountId, onDone);
  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5">
      <button className={primary} disabled={busy} onClick={run}>
        {busy ? "Забираем…" : "Забрать"}
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

function dropRight(i: ProgressItem): { text: string; fg: string; dot: Parameters<typeof StatusDot>[0]["status"] } {
  if (isReady(i)) return { text: i.accountConnected === false ? "нужна привязка" : "можно забрать", fg: "text-acc-t", dot: "ready" };
  if (i.status === "claimed") return { text: "получено", fg: "text-ok", dot: "claimed" };
  if (i.status === "expired") return { text: "истекло", fg: "text-bad", dot: "expired" };
  if (i.status === "unknown") return { text: "нет данных", fg: "text-mut", dot: "unknown" };
  const text = i.requiredMinutes ? `${i.minutesWatched ?? 0} из ${i.requiredMinutes} мин` : i.requiredSubs ? `подписка ${i.subsCurrent ?? 0}/${i.requiredSubs}` : "—";
  return { text, fg: i.status === "in_progress" ? "text-run" : "text-mut", dot: i.status };
}

function Accounts({ accounts, progress, now }: { accounts: Account[]; progress?: Progress; now: number }) {
  return (
    <section className="flex flex-col gap-4 md:gap-[18px]">
      <h2 className={kicker}>Ваши аккаунты и ближайшие награды</h2>
      <div className="grid gap-5 md:grid-cols-3 md:gap-10">
        {accounts.map((a) => (
          <Card key={a.id} className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/accounts/${a.id}`} className="text-[15px] font-medium hover:text-acc-t">
                {a.displayName}
              </Link>
              <AccountBadge status={a.status} />
              <span className="ml-auto text-xs text-mut">{now ? timeAgo(a.lastSyncedAt, now) : "…"}</span>
            </div>
            {sortProgress(progress?.[a.id] ?? [])
              .slice(0, 3)
              .map((i) => {
                const r = dropRight(i);
                return (
                  <div key={i.campaignId} className="flex items-center gap-2 text-[13px]">
                    <StatusDot status={r.dot} />
                    <span className="min-w-0 flex-1 truncate">{i.name}</span>
                    <span className={`shrink-0 text-xs ${r.fg}`}>{r.text}</span>
                  </div>
                );
              })}
            <Link href={`/accounts/${a.id}`} className="text-[13px] text-acc-t hover:text-fg">
              Все награды аккаунта →
            </Link>
          </Card>
        ))}
        {accounts.length === 0 && <Empty>Нет аккаунтов</Empty>}
      </div>
    </section>
  );
}
