"use client";

import { useSyncExternalStore } from "react";
import type { LiveChannel, ProgressItem } from "@/lib/client";
import { earned } from "@/lib/drops";
import { minutesText, percent, SUB_HINT, subsText, timeAgo, timeLeft } from "@/lib/format";
import { ChannelChips } from "./channel-chips";
import { KindBadge, ProgressBadge, ProgressBar, Thumb } from "./ui";

// Shared clock for relative labels, ticking every 30 s so "N мин назад" does not go stale.
// The server snapshot is 0: the current time must not be baked into the prerendered shell.
let clock = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    clock = Date.now();
    listeners.forEach((l) => l());
  }, 30_000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) timer = void clearInterval(timer);
  };
}

export function useNow() {
  return useSyncExternalStore(
    subscribe,
    () => (clock ||= Date.now()),
    () => 0,
  );
}

export function isReady(item: ProgressItem) {
  return item.status === "in_progress" && earned(item.minutesWatched, item.requiredMinutes, item.subsCurrent, item.requiredSubs);
}

// Sub drops come with zero watch minutes; their progress is the sub count.
export function isSubDrop(item: Pick<ProgressItem, "requiredMinutes" | "requiredSubs">) {
  return !item.requiredMinutes && !!item.requiredSubs;
}

const isOpen = (s: ProgressItem["status"]) => s === "in_progress" || s === "not_started" || s === "unknown";

export function ProgressRow({ item, now, channels }: { item: ProgressItem; now: number; channels?: LiveChannel[] }) {
  const left = item.status === "claimed" ? null : timeLeft(item.endsAt, now);
  const bySub = isSubDrop(item);
  const meta = [bySub ? SUB_HINT : null, left, `обновлено ${timeAgo(item.fetchedAt, now)}`, item.source === "manual" ? "вручную" : null];
  return (
    <div className="flex gap-3 py-3">
      <Thumb src={item.imageUrl} alt={item.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-medium">{item.name}</p>
          <div className="flex gap-1">
            {item.kind === "badge" && <KindBadge kind="badge" />}
            <ProgressBadge status={item.status} ready={isReady(item)} />
          </div>
        </div>
        {item.campaignName && <p className="truncate text-xs text-mut">{item.campaignName}</p>}
        <div className="mt-2 flex items-center gap-3">
          <ProgressBar
            value={bySub ? percent(item.subsCurrent, item.requiredSubs, item.status) : percent(item.minutesWatched, item.requiredMinutes, item.status)}
            muted={item.status === "expired"}
          />
          <span className="shrink-0 text-xs tabular-nums text-mut">
            {item.status === "unknown"
              ? "нет данных"
              : bySub
                ? subsText(item.subsCurrent, item.requiredSubs!)
                : minutesText(item.minutesWatched, item.requiredMinutes)}
          </span>
        </div>
        <p className="mt-1 text-xs text-mut">{meta.filter(Boolean).join(" · ")}</p>
        {isOpen(item.status) && item.accountConnected === false && item.accountLinkUrl && (
          <p className="mt-1 text-xs text-warn">
            Аккаунт игры не привязан, награду не выдадут.{" "}
            <a href={item.accountLinkUrl} target="_blank" rel="noreferrer" className="font-medium underline">
              Привязать
            </a>
          </p>
        )}
        {isOpen(item.status) && !isReady(item) && !bySub && channels && channels.length > 0 && (
          <div className="mt-2">
            <ChannelChips channels={channels.slice(0, 3)} />
          </div>
        )}
      </div>
    </div>
  );
}
