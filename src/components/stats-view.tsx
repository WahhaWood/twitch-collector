"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { fetcher, POLL_MS, type StatsResponse, viewerTimeZone } from "@/lib/client";
import { dateTimeText, dayLabel, durationText, errorText, percentText, timeLeft } from "@/lib/format";
import { BarList, ColumnChart, StackedMeter, StatTile } from "./charts";
import { useNow } from "./progress-row";
import { Card, Empty, ErrorBox, Segmented, Skeleton, Thumb } from "./ui";
import { RiskBadge } from "./risk-badge";

const RANGES = [
  { value: 7, label: "7 дней" },
  { value: 30, label: "30 дней" },
  { value: 90, label: "90 дней" },
];

export function StatsView() {
  const [days, setDays] = useState(30);
  const now = useNow();
  // The time zone is known only in the browser; until then (prerender) nothing is fetched.
  const key = now ? `/api/stats?days=${days}&tz=${encodeURIComponent(viewerTimeZone())}` : null;
  const { data, error, isValidating } = useSWR<StatsResponse>(key, fetcher, { refreshInterval: POLL_MS, keepPreviousData: true });

  return (
    <div className="flex flex-col gap-4">
      <Segmented options={RANGES} value={days} onChange={setDays} label="Период" />
      {error ? (
        <ErrorBox>Не удалось загрузить статистику</ErrorBox>
      ) : !data ? (
        <Skeleton rows={5} />
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${isValidating && data.days !== days ? "opacity-60" : ""}`}>
          <Content data={data} now={now} />
        </div>
      )}
    </div>
  );
}

function Content({ data, now }: { data: StatsResponse; now: number }) {
  const t = data.totals;
  if (t.accounts === 0 && t.rewardsAllTime === 0) {
    return (
      <Empty>
        Статистика появится после подключения аккаунта на странице{" "}
        <Link href="/accounts" className="font-medium text-acc-t underline">
          «Аккаунты»
        </Link>
        .
      </Empty>
    );
  }
  const watchedAny = data.daily.some((d) => d.minutes > 0);
  const rewardsAny = data.daily.some((d) => d.rewards > 0);
  const anyGameWatched = data.byGame.some((g) => g.watched > 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <StatTile label="Наград получено" value={t.rewardsAllTime} hint={`+${t.rewardsInRange} за ${data.days} дн`} accent />
        <StatTile label="Просмотрено" value={durationText(t.watchedMinutes)} hint={`за ${data.days} дн, по синхронизациям`} />
        <StatTile label="Серия" value={`${t.streak} дн`} hint="дней подряд с просмотром" />
        <StatTile label="Осталось досмотреть" value={durationText(t.remainingMinutes)} hint={`в ${t.activeCampaigns} активных кампаниях`} />
        <StatTile label="Под угрозой" value={t.atRisk} hint={t.needsLink ? `${t.needsLink} ждут привязки игры` : "начатые, могут не успеть"} />
        <StatTile
          label="Синхронизация"
          value={percentText(data.sync.okRate)}
          hint={data.sync.avgSeconds !== null ? `${data.sync.runs} запусков, ~${data.sync.avgSeconds.toFixed(1)} с` : "пока нет запусков"}
        />
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Минуты просмотра по дням</h2>
        {watchedAny ? (
          <>
            <ColumnChart
              data={data.daily.map((d) => ({
                label: dayLabel(d.day),
                value: d.minutes,
                tooltip: (
                  <>
                    <span className="font-semibold tabular-nums">{durationText(d.minutes)}</span>
                    <span className="text-mut"> · {dayLabel(d.day)}</span>
                  </>
                ),
              }))}
              format={(v) => (v >= 60 ? `${Math.round(v / 60)} ч` : `${v}`)}
            />
            <DailyTable data={data} />
          </>
        ) : (
          <p className="text-sm text-mut">
            Пока пусто. Минуты считаются по приросту прогресса между синхронизациями, так что график наполнится, когда вы
            посмотрите стримы с дропсами.
          </p>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Награды по дням</h2>
          {rewardsAny ? (
            <ColumnChart
              tone="emerald"
              height={120}
              data={data.daily.map((d) => ({
                label: dayLabel(d.day),
                value: d.rewards,
                tooltip: (
                  <>
                    <span className="font-semibold tabular-nums">{d.rewards}</span>
                    <span className="text-mut"> · {dayLabel(d.day)}</span>
                  </>
                ),
              }))}
              format={(v) => String(Math.round(v))}
            />
          ) : (
            <p className="text-sm text-mut">За {data.days} дней наград не было.</p>
          )}
        </Card>
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Состояние дропсов</h2>
          <StackedMeter
            segments={[
              { label: "Получено", value: t.claimed, tone: "emerald" },
              { label: "В процессе", value: t.inProgress, tone: "violet" },
              { label: "Нет данных", value: t.unknown, tone: "amber" },
              { label: "Не начато", value: t.notStarted, tone: "neutral" },
              { label: "Истекло", value: t.expired, tone: "faint" },
            ]}
          />
          <p className="text-xs text-mut">
            Завершено {percentText(t.completion)} из известных · можно забрать: {t.ready}
          </p>
        </Card>
      </div>

      {data.risks.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">Под угрозой</h2>
          <ul className="divide-y divide-line">
            {data.risks.map((r) => (
              <li key={`${r.accountId}-${r.key}`} className="flex items-center gap-3 py-2">
                <Thumb src={r.imageUrl} alt={r.campaignName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.campaignName}</p>
                  <p className="truncate text-xs text-mut">
                    {[r.accountName, r.gameName, `нужно ${durationText(r.remainingMinutes)}`, timeLeft(r.endsAt, now)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <RiskBadge risk={r.risk} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">По играм</h2>
          <p className="-mt-2 text-xs text-mut">
            {anyGameWatched ? "Просмотрено в кампаниях игры, сейчас" : "Просмотра пока нет — показано число дропсов"}
          </p>
          <BarList
            rows={data.byGame.map((g) => ({
              label: g.game,
              value: anyGameWatched ? g.watched : g.drops,
              display: anyGameWatched ? durationText(g.watched) : `${g.drops} дропс.`,
              sub: `получено ${g.claimed} из ${g.drops}${g.remaining ? ` · осталось ${durationText(g.remaining)}` : ""}`,
            }))}
          />
        </Card>
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Аккаунты</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-mut">
                <tr>
                  <th className="py-1 pr-2 font-normal">Аккаунт</th>
                  <th className="px-2 py-1 text-right font-normal">Просмотр</th>
                  <th className="px-2 py-1 text-right font-normal">Награды</th>
                  <th className="py-1 pl-2 text-right font-normal">Осталось</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {data.byAccount.map((a) => (
                  <tr key={a.id}>
                    <td className="max-w-32 truncate py-1.5 pr-2">
                      <Link href={`/accounts/${a.id}`} className="hover:text-acc-t">
                        {a.displayName}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-right">{durationText(a.watchedMinutes)}</td>
                    <td className="px-2 py-1.5 text-right">{a.rewards}</td>
                    <td className="py-1.5 pl-2 text-right">{durationText(a.remainingMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.sync.lastError && (
            <p className="text-xs text-mut">
              Последняя ошибка синхронизации: {errorText(data.sync.lastError.code, data.sync.lastError.code)},{" "}
              {dateTimeText(data.sync.lastError.at)}
            </p>
          )}
        </Card>
      </div>

      {data.recentRewards.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Последние награды</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.recentRewards.map((r) => (
              <li key={`${r.accountId}-${r.name}-${r.awardedAt}`} className="flex items-center gap-3">
                <Thumb src={r.imageUrl} alt={r.name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="truncate text-xs text-mut">
                    {r.accountName} · {dateTimeText(r.awardedAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function DailyTable({ data }: { data: StatsResponse }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-mut hover:text-acc-t">Показать таблицей</summary>
      <table className="mt-2 w-full text-sm tabular-nums">
        <thead className="text-left text-xs text-mut">
          <tr>
            <th className="py-1 font-normal">День</th>
            <th className="py-1 text-right font-normal">Просмотр</th>
            <th className="py-1 text-right font-normal">Награды</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[...data.daily].reverse().map((d) => (
            <tr key={d.day}>
              <td className="py-1">{dayLabel(d.day)}</td>
              <td className="py-1 text-right">{durationText(d.minutes)}</td>
              <td className="py-1 text-right">{d.rewards}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
