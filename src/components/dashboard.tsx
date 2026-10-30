"use client";

import Link from "next/link";
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
  WORKER_STALE_MS,
} from "@/lib/client";
import { ACCOUNT_LABEL, type AccountStatus, durationText, SUB_HINT, timeAgo } from "@/lib/format";
import { channelHue, greeting, leftShort, segments, timelineBar, WINDOW_MIN } from "@/lib/overview";
import { sortProgress } from "./account-view";
import { isReady, useNow } from "./progress-row";
import { Empty, ErrorBox, Skeleton, StatusDot } from "./ui";
import { useSync } from "./use-sync";

const MIN = 60_000;
const LINKS_SHOWN = 3;

const RISK: Record<Risk, { label: string; fg: string; bg: string }> = {
  ok: { label: "успеваете", fg: "text-ok", bg: "bg-ok" },
  tight: { label: "впритык", fg: "text-warn", bg: "bg-warn" },
  impossible: { label: "не успеть", fg: "text-bad", bg: "bg-bad" },
};

const ACCOUNT_FG: Record<AccountStatus, string> = {
  active: "text-ok",
  pending: "text-mut",
  expired: "text-bad",
  revoked: "text-mut",
  error: "text-bad",
};

const kicker = "text-[11px] tracking-[.1em] text-mut uppercase";
const secondary = "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-line px-3.5 text-sm font-medium hover:bg-fg/7 md:min-h-0 md:py-2";
const primary = "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-acc px-3.5 text-sm font-medium text-acc-t hover:bg-acc/12 disabled:opacity-45 md:min-h-0 md:py-2";

type Progress = Record<number, ProgressItem[]>;

export function Dashboard({ name }: { name: string }) {
  const now = useNow();
  const { data, error } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher, { refreshInterval: POLL_MS });
  const accounts = data?.accounts.filter((a) => a.status !== "revoked");
  const ids = accounts?.map((a) => a.id) ?? [];
  const progress = useSWR<Progress>(ids.length ? ["progress", ...ids] : null, () => loadProgress(ids), { refreshInterval: POLL_MS });
  const plan = useSWR<PlanResponse>(accounts?.length ? "/api/plan" : null, fetcher, { refreshInterval: POLL_MS });
  const stats = useSWR<StatsResponse>(accounts?.length && now ? `/api/stats?days=7&tz=${encodeURIComponent(viewerTimeZone())}` : null, fetcher, {
    refreshInterval: POLL_MS,
  });
  const streaks = useSWR<StreaksResponse>(accounts?.some((a) => a.watching?.some((w) => w.kind === "streak")) ? "/api/streaks" : null, fetcher, {
    refreshInterval: POLL_MS,
  });

  const refresh = () => Promise.all([progress.mutate(), plan.mutate(), stats.mutate()]);
  const hello = `${now ? greeting(new Date(now).getHours()) : "Здравствуйте"}, ${name}`;

  if (error) return <ErrorBox>Не удалось загрузить аккаунты</ErrorBox>;
  if (!accounts) return <Skeleton />;
  if (!accounts.length) {
    return (
      <>
        <h1 className="text-[22px] font-medium tracking-[-.015em] sm:text-[28px]">{hello}</h1>
        <Empty>
          Подключите Twitch-аккаунт на странице{" "}
          <Link href="/accounts" className="font-medium text-acc-t underline">
            «Аккаунты»
          </Link>
          , и здесь появятся сроки кампаний и прогресс дропсов.
        </Empty>
      </>
    );
  }

  const worker = workerState(accounts, now);
  const t = stats.data?.totals;
  const totals = t && [
    { v: t.ready, label: "можно забрать", fg: "text-acc-t" },
    { v: t.inProgress, label: "в процессе" },
    { v: t.claimed, label: "получено" },
    { v: t.remainingMinutes, label: "минут осталось" },
  ];

  return (
    <div className="flex flex-col gap-[26px] md:gap-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8">
        <div>
          <h1 className="text-[22px] font-medium tracking-[-.015em] md:text-[28px]">{hello}</h1>
          <p className="mt-1 text-sm text-mut">{worker.line}</p>
        </div>
        {totals && (
          <div className="grid grid-cols-4 gap-2 md:flex md:gap-9">
            {totals.map((x) => (
              <div key={x.label}>
                <div className={`text-xl leading-none font-medium md:text-[26px] ${x.fg ?? ""}`}>{x.v}</div>
                <div className="mt-1 text-[11px] leading-tight text-mut md:mt-[5px] md:text-xs">{x.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {worker.down && (
        <div className="flex flex-col gap-1 rounded-lg bg-warn-bg px-3 py-3 text-sm text-warn md:flex-row md:items-center md:gap-3.5 md:px-[18px] md:py-3.5">
          <b className="font-medium">Воркер не запущен</b>
          <span>
            {worker.since ? `Автопросмотр стоит с ${worker.since}.` : "Автопросмотр включён, но воркер не работает."} Полосы ниже не двигаются.
          </span>
          <Link href="/accounts" className="underline md:ml-auto">
            Как запустить
          </Link>
        </div>
      )}
      {worker.watching.length > 0 && (
        <div className="grid gap-[18px] md:grid-cols-2 md:gap-10">
          {worker.watching.map((w) => (
            <NowWatching key={`${w.account.id}:${w.login}`} {...w} progress={progress.data} streaks={streaks.data} />
          ))}
        </div>
      )}

      {plan.error ? <ErrorBox>Не удалось составить план</ErrorBox> : plan.data ? <Timeline plan={plan.data} now={now} onChange={() => plan.mutate()} /> : <Skeleton rows={2} />}

      <div className="grid gap-[26px] md:grid-cols-3 md:gap-10">
        <ClaimAndLink plan={plan.data} progress={progress.data} accounts={accounts} onDone={refresh} />
        <Accounts accounts={accounts} progress={progress.data} now={now} />
      </div>
    </div>
  );
}

async function loadProgress(ids: number[]): Promise<Progress> {
  const all = await Promise.all(ids.map((id) => fetcher<ProgressResponse>(`/api/accounts/${id}/progress`)));
  return Object.fromEntries(all.map((r) => [r.account.id, r.items]));
}

function workerState(accounts: Account[], now: number) {
  const auto = accounts.filter((a) => a.autoWatch && a.status === "active");
  const fresh = (a: Account) => !!a.watchingAt && now - new Date(a.watchingAt).getTime() < WORKER_STALE_MS;
  const up = auto.filter(fresh);
  const watching = up.flatMap((a) => (a.watching ?? []).map((w) => ({ ...w, account: a })));
  if (up.length) {
    const n = new Set(watching.map((w) => w.account.id)).size;
    return { line: `Воркер работает · ${n} ${n === 1 ? "аккаунт смотрит" : "аккаунта смотрят"} эфиры`, down: false, since: null, watching };
  }
  if (!auto.length) return { line: "Автопросмотр выключен", down: false, since: null, watching };
  const last = Math.max(0, ...auto.map((a) => (a.watchingAt ? new Date(a.watchingAt).getTime() : 0)));
  const since = last ? new Date(last).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : null;
  return { line: "Воркер не запущен", down: true, since, watching };
}

function Avatar({ login, size }: { login: string; size: string }) {
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-avatar ${size}`}
      style={{ background: `oklch(0.52 0.11 ${channelHue(login)})`, boxShadow: "0 0 0 2px var(--bg), 0 0 0 3.5px var(--bad)" }}
      aria-hidden
    >
      {login[0]?.toUpperCase()}
    </div>
  );
}

function NowWatching({ kind, login, displayName, campaignName, account, progress, streaks }: {
  kind: "drop" | "streak";
  login: string;
  displayName: string;
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
    if (next) goal = { cur: next.i.minutesWatched ?? 0, max: next.i.requiredMinutes!, label: next.i.name, eta: `награда через ${durationText(next.left)}` };
  } else if (streaks) {
    const ch = streaks.channels.find((c) => c.accountId === account.id && c.login === login);
    const max = Math.round(streaks.goalSeconds / 60);
    if (ch) {
      const cur = Math.min(max, Math.floor(ch.watchedSeconds / 60));
      goal = { cur, max, label: "Стрик за эфир", eta: cur >= max ? "засчитан" : `засчитается через ${durationText(max - cur)}` };
    }
  }

  return (
    <div className="flex flex-col gap-2 md:gap-2.5">
      <div className="flex items-center gap-2.5 md:gap-3">
        <Avatar login={login} size="size-[30px] text-xs md:size-9 md:text-sm" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px]">
            <a href={`https://www.twitch.tv/${encodeURIComponent(login)}`} target="_blank" rel="noreferrer" className="font-medium hover:text-acc-t">
              {displayName}
            </a>{" "}
            <span className="text-[13px] text-mut md:text-[15px]">· {account.displayName}</span>
          </div>
          <div className="truncate text-xs text-mut md:text-[13px]">
            <span className="hidden md:inline">{kind === "streak" ? "Стрик" : "Дропсы"}: </span>
            {kind === "streak" ? `Стрик канала ${displayName}` : campaignName}
          </div>
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
          <div className="flex justify-between text-xs text-mut">
            <span className="hidden md:inline">{goal.label}</span>
            <span className="text-acc-t">{goal.eta}</span>
          </div>
        </>
      )}
    </div>
  );
}

type Row = PlanItem & { accountName: string };

function Timeline({ plan, now, onChange }: { plan: PlanResponse; now: number; onChange: () => unknown }) {
  const watch: Row[] = plan.accounts.flatMap((a) => a.items.filter((i) => i.action === "watch").map((i) => ({ ...i, accountName: a.displayName })));
  const leftOf = (r: Row) => (r.endsAt && now ? (new Date(r.endsAt).getTime() - now) / MIN : Infinity);
  const soon = watch.filter((r) => leftOf(r) <= WINDOW_MIN && r.remainingMinutes !== null).sort((a, b) => leftOf(a) - leftOf(b));
  const later = watch.filter((r) => !soon.includes(r)).sort((a, b) => leftOf(a) - leftOf(b));
  const skipped = plan.accounts.flatMap((a) => a.skipped.map((s) => ({ ...s, accountId: a.id })));
  const ticks = [0, 2, 4, 6, 8];

  return (
    <div className="flex flex-col gap-1 md:gap-1.5">
      <div className="flex items-baseline justify-between md:grid md:grid-cols-[280px_minmax(0,1fr)_190px] md:items-end md:gap-6">
        <span className={kicker}>Сроки · 8 часов</span>
        <span className="text-[11px] text-mut md:hidden">сейчас → 8 ч</span>
        <div className="relative hidden h-[18px] text-[11px] text-mut md:block">
          {ticks.map((h) => (
            <span
              key={h}
              className={`absolute bottom-0 whitespace-nowrap ${h === 0 ? "" : h === 8 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: `${(h / 8) * 100}%` }}
            >
              {h === 0 ? "сейчас" : `${h} ч`}
            </span>
          ))}
        </div>
      </div>
      {soon.length === 0 && <p className="rule py-3.5 text-sm text-mut">В ближайшие 8 часов ничего не сгорает.</p>}
      {soon.map((r) => (
        <TimelineRow key={`${r.accountId}:${r.key}`} row={r} left={leftOf(r)} onChange={onChange} />
      ))}
      {(later.length > 0 || skipped.length > 0) && (
        <div className="flex flex-col gap-1 pt-2 text-[13px] text-mut">
          {later.length > 0 && (
            <p>
              Позже:{" "}
              {later.map((r, i) => (
                <span key={`${r.accountId}:${r.key}`}>
                  {i > 0 && " · "}
                  {r.campaignName} — {Number.isFinite(leftOf(r)) ? `через ${leftShort(leftOf(r))}` : "без срока"}
                  {r.risk && <span className={RISK[r.risk].fg}> · {RISK[r.risk].label}</span>}
                </span>
              ))}
            </p>
          )}
          {skipped.length > 0 && (
            <p>
              Пропущено:{" "}
              {skipped.map((s, i) => (
                <span key={`${s.accountId}:${s.key}`}>
                  {i > 0 && " · "}
                  {s.campaignName}
                  {s.reason === "no_progress" && " (просмотр не засчитывается)"}{" "}
                  <button className="text-acc-t hover:text-fg" onClick={() => setSkipped(s.accountId, s.key, null).then(onChange)}>
                    вернуть
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function setSkipped(accountId: number, key: string, name: string | null) {
  return api(`/api/accounts/${accountId}/skipped`, {
    method: name ? "POST" : "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(name ? { key, name } : { key }),
  }).catch(() => undefined);
}

function TimelineRow({ row, left, onChange }: { row: Row; left: number; onChange: () => unknown }) {
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
      <button className={secondary} onClick={() => setSkipped(row.accountId, row.key, row.campaignName).then(onChange)}>
        Пропустить
      </button>
    ) : (
      <a
        className={secondary}
        target="_blank"
        rel="noreferrer"
        href={channel ? `https://www.twitch.tv/${encodeURIComponent(channel.login)}` : `https://www.twitch.tv/search?term=${encodeURIComponent(row.gameName ?? row.campaignName)}`}
      >
        {channel ? (
          <>
            Смотреть<span className="hidden md:inline">&nbsp;{channel.displayName}</span>
          </>
        ) : (
          "Найти стрим"
        )}
      </a>
    );
  const track = (
    <div className="relative h-[22px] md:h-7">
      <div className="absolute inset-x-0 top-2.5 h-0.5 bg-track md:top-[13px]" />
      <div className={`absolute top-1.5 left-0 h-2.5 rounded-[3px] md:top-2 md:h-3 ${risk.bg}`} style={{ width: bar.fit }} />
      <div className="hatch absolute top-1.5 h-2.5 rounded-r-[3px] md:top-2 md:h-3" style={{ left: bar.deadline, width: bar.over }} />
      <div className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: bar.deadline }} />
      <div className="absolute -top-0.5 hidden pl-1.5 text-[11px] whitespace-nowrap md:block" style={{ left: bar.deadline }}>
        {leftShort(left)}
      </div>
    </div>
  );

  return (
    <div className="rule py-3 md:grid md:grid-cols-[280px_minmax(0,1fr)_190px] md:items-center md:gap-6 md:py-3.5">
      {/* phone */}
      <div className="flex flex-col gap-1.5 md:hidden">
        <div className="flex items-baseline justify-between gap-2.5">
          <span className="min-w-0 text-[15px]">{row.campaignName}</span>
          <span className={`text-xs whitespace-nowrap ${risk.fg}`}>{risk.label}</span>
        </div>
        {reward && <div className="truncate text-xs text-mut">за просмотр: {reward}</div>}
        {subs}
        {track}
        <div className="flex items-center gap-2.5">
          <span className="flex-1 text-xs text-mut">
            конец через {leftShort(left)} · ещё {durationText(remaining)}
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
            {row.accountName} · ещё {durationText(remaining)} · <span className={risk.fg}>{risk.label}</span>
          </div>
          {subs}
        </div>
      </div>
      <div className="hidden md:block">{track}</div>
      <div className="hidden md:flex">{action}</div>
    </div>
  );
}

function ClaimAndLink({ plan, progress, accounts, onDone }: { plan?: PlanResponse; progress?: Progress; accounts: Account[]; onDone: () => unknown }) {
  const claims = accounts.flatMap((a) =>
    (progress?.[a.id] ?? []).filter((i) => isReady(i) && i.accountConnected !== false).map((i) => ({ item: i, account: a })),
  );
  const links = (plan?.accounts ?? []).flatMap((a) => a.items.filter((i) => i.action === "link").map((i) => ({ ...i, accountName: a.displayName })));
  if (!claims.length && !links.length) return <div className="md:col-span-2" />;

  return (
    <div className="flex flex-col gap-1.5 md:col-span-2 md:gap-2.5">
      <div className={kicker}>Забрать и привязать</div>
      {claims.map(({ item, account }) => (
        <div key={`${account.id}:${item.campaignId}`} className="flex items-center gap-3 py-1.5 md:gap-3.5 md:py-0">
          <RewardThumb src={item.imageUrl} label={item.gameName ?? item.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px]">{item.name}</div>
            <div className="truncate text-xs text-mut">
              <span className="hidden md:inline">{item.campaignName} · </span>
              {account.displayName}
            </div>
          </div>
          <ClaimButton accountId={account.id} onDone={onDone} />
        </div>
      ))}
      {links.slice(0, LINKS_SHOWN).map((l) => (
        <div key={`${l.accountId}:${l.key}`} className="flex items-center gap-3 py-1.5 md:gap-3.5 md:py-0">
          <div className="hidden size-9 shrink-0 place-items-center rounded-md bg-sf2 text-mut md:grid">
            <svg width="18" height="18" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="18" strokeLinecap="round" aria-hidden>
              <path d="M112 144a40 40 0 0 1 0-56l32-32a40 40 0 0 1 56 56l-16 16M144 112a40 40 0 0 1 0 56l-32 32a40 40 0 0 1-56-56l16-16" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px]">{l.campaignName}</div>
            <div className="truncate text-xs text-mut">{l.accountName} · награды не придут без привязки аккаунта игры</div>
          </div>
          {l.accountLinkUrl && (
            <a href={l.accountLinkUrl} target="_blank" rel="noreferrer" className="shrink-0 text-sm text-acc-t hover:text-fg">
              Привязать ↗
            </a>
          )}
        </div>
      ))}
      {links.length > LINKS_SHOWN && <p className="text-xs text-mut">И ещё {links.length - LINKS_SHOWN} ждут привязки — на страницах аккаунтов.</p>}
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
  if (isReady(i)) return { text: "забрать", fg: "text-acc-t", dot: "ready" };
  if (i.status === "claimed") return { text: "получено", fg: "text-ok", dot: "claimed" };
  if (i.status === "expired") return { text: "истекло", fg: "text-bad", dot: "expired" };
  if (i.status === "unknown") return { text: "нет данных", fg: "text-mut", dot: "unknown" };
  const text = i.requiredMinutes ? `${i.minutesWatched ?? 0}/${i.requiredMinutes}` : i.requiredSubs ? `подписка ${i.subsCurrent ?? 0}/${i.requiredSubs}` : "—";
  return { text, fg: i.status === "in_progress" ? "text-run" : "text-mut", dot: i.status };
}

function Accounts({ accounts, progress, now }: { accounts: Account[]; progress?: Progress; now: number }) {
  return (
    <div className="flex flex-col gap-4 md:gap-[18px]">
      <div className={kicker}>Аккаунты</div>
      {accounts.map((a) => (
        <div key={a.id} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Link href={`/accounts/${a.id}`} className="text-[15px] font-medium hover:text-acc-t md:text-sm">
              {a.displayName}
            </Link>
            <span className={`text-xs ${ACCOUNT_FG[a.status]}`}>
              {ACCOUNT_LABEL[a.status]} <span className="text-mut">· {now ? timeAgo(a.lastSyncedAt, now) : "…"}</span>
            </span>
          </div>
          {sortProgress(progress?.[a.id] ?? [])
            .slice(0, 3)
            .map((i) => {
              const r = dropRight(i);
              return (
                <div key={i.campaignId} className="flex items-center gap-2 text-[13px]">
                  <StatusDot status={r.dot} />
                  <span className="min-w-0 flex-1 truncate">{i.name}</span>
                  <span className={`text-xs ${r.fg}`}>{r.text}</span>
                </div>
              );
            })}
          {a.status === "expired" && (
            <Link href="/accounts" className="text-[13px] text-acc-t hover:text-fg">
              Переподключить
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

