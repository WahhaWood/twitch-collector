import type { LiveChannel } from "@/lib/client";
import { compactNumber } from "@/lib/format";

// Live channels where a campaign counts; without any, a Twitch search for the game.
export function ChannelChips({ channels, fallbackSearch }: { channels: LiveChannel[]; fallbackSearch?: string | null }) {
  if (!channels.length) {
    if (!fallbackSearch) return null;
    return (
      <a
        href={`https://www.twitch.tv/search?term=${encodeURIComponent(fallbackSearch)}`}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-acc-t hover:underline"
      >
        Найти стрим на Twitch →
      </a>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {channels.map((c) => (
        <a
          key={c.login}
          href={`https://www.twitch.tv/${encodeURIComponent(c.login)}`}
          target="_blank"
          rel="noreferrer"
          title={c.title ?? undefined}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line py-0.5 pr-2.5 pl-0.5 text-xs hover:border-acc hover:text-acc-t"
        >
          {c.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.avatarUrl} alt="" className="size-5 rounded-full" loading="lazy" />
          ) : (
            <span className="size-2 rounded-full bg-bad" />
          )}
          <span className="truncate font-medium">{c.displayName}</span>
          {c.viewers !== null && <span className="text-mut">{compactNumber(c.viewers)}</span>}
        </a>
      ))}
    </div>
  );
}
