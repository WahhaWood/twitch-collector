# Patterns

- cacheComponents: `Date.now()` в client component при prerender ломает build. Текущее время брать через `useSyncExternalStore` с server snapshot `0` (`src/components/progress-row.tsx`, `useNow`).
- cacheComponents: `usePathname()` в общей шапке требует Suspense на динамических маршрутах. Проще передавать активный раздел пропсом (`src/components/shell.tsx`).
- `RouteContext` / `PageProps` появляются только после `next typegen`, поэтому `npm run typecheck` запускает его первым.
- Dev-сервер после переписывания модуля (`src/lib/twitch.ts`) отдавал устаревший модуль (`instanceof` на undefined). Перезапустить `next dev` (гипотеза: кэш Turbopack).
- gql.twitch.tv принимает только токены клиентов Twitch; токен своего OAuth-приложения получает 401 (Plan.md, «Спайк GQL»).
- Twitch GQL с 2026-09: `currentUser.dropCampaigns` и `dropCampaign(id)` возвращают null без ошибки (integrity). Работают `streams(options:{systemFilters:[DROPS_ENABLED]})` (first ≤ 30) и `channel(id).viewerDropCampaigns` (≤ 15 алиасов на запрос) — `src/lib/sync.ts` fetchDropSources.
- Twitch GQL: у `Channel` нет поля `login` (ошибка схемы); логин/аватар/зрители берём из `streams.edges.node.broadcaster` и `viewersCount` (`src/lib/drops.ts` liveChannels).
- Статистика: чистые функции в `src/lib/stats.ts`, загрузка из БД отдельно в `src/lib/stats-data.ts`; дни бакетим в tz браузера (`?tz=`), не в UTC.
- Цвета графиков проверены dataviz-валидатором: emerald-600 / violet-600 (dark: violet-500) / amber-600; серый только для нейтрального остатка (`src/components/charts.tsx`).
- Twitch watch-протокол (сверено с TwitchDropsMiner / Channel-Points-Miner-v2, живьём 2026-10-30): raw `streamPlaybackAccessToken` → usher m3u8 → HEAD чанка, spade `minute-watched` (base64 в поле `data`, ответ 204), `claimDropRewards` — всё работает с TV-токеном (`src/lib/watch.ts`). Засчитываются ли дропсы — не подтверждено (Plan.md, этап 6).
- `pkill -f <шаблон>` в той же Bash-команде убивает саму команду (шаблон есть в её строке). Останавливать по PID из `pgrep -af`.
- Twitch дропы за подписку: `requiredSubs > 0`, `requiredMinutesWatched = 0`, прогресс в `self.currentSubs`. Одна кампания может мешать sub- и watch-дропы; имя кампании = имя первой награды (`src/lib/drops.ts` earned, `stats.ts` subDrops).
