# Plan (источник: plan-mvp.md)

## Этап 0. Спайк и каркас
- [x] ~~Репозиторий, Next.js + TS + Tailwind, зависимости (drizzle, neon, swr, zod, vitest)~~
- [x] ~~Схема БД (drizzle) + первая миграция, env-валидация, AES-GCM/хэш токена с тестами~~
- [ ] shadcn/ui init — не делали: UI на чистом Tailwind (src/components/ui.tsx), shadcn добавить при необходимости
- [x] ~~CI (GitHub Actions): lint, typecheck, test, build~~ (.github/workflows/ci.yml; в GitHub ещё не прогонялся — репо без коммитов)
- [x] ~~Neon: проект создан, миграция 0000 применена (DATABASE_URL в .env.local)~~
- [x] ~~Решение владельца: используем неофициальный GraphQL (2026-10-30)~~
- [x] ~~Спайк: fixtures прогресса дропсов~~ (реальная: drops-sources.real.json)

## Этап 1. Вход по токену
- [x] ~~scripts/user-create.mts~~ (`npm run user:create -- --name`)
- [x] ~~/api/auth/login, /logout, /api/me, подписанная cookie, src/proxy.ts, лимит попыток по IP~~
- [x] ~~Тесты cookie (подделка/истечение) и ручная проверка login/me/logout на dev-сервере~~
- [x] ~~Автотест изоляции по user_id~~ (accounts.test.ts: условие ownedAccount; вручную: чужой аккаунт → 404 на progress/sync/delete)
- [x] ~~Twitch-переменные в env.ts~~ (после перехода на device flow осталась только TWITCH_GQL_CLIENT_ID с default)

## Решения по входу (2026-10-30)
- Вход на сайт — по личному токену (свой, не Neon Auth). Twitch OAuth — отдельный шаг: подключение аккаунта к уже вошедшему пользователю.
- Neon Auth не используем.

## Этап 2. Twitch OAuth и аккаунты (2026-10-30)
- [x] ~~oauth-state (PKCE + подписанная cookie, тесты), src/lib/twitch.ts, Twitch-переменные обязательны в env.ts~~
- [x] ~~/api/twitch/authorize, /callback, GET /api/accounts, DELETE /api/accounts/[id], лимит 5 (typecheck/lint/tests зелёные)~~
- [x] ~~Ручная проверка OAuth: аккаунт подключён, токены в БД зашифрованы~~
- [x] ~~Кнопка «Подключить Twitch» и список аккаунтов в UI~~
- [x] ~~Проверить `npm run build` (починен Suspense в page.tsx)~~
- [x] ~~Автотест изоляции по user_id для /api/accounts~~

## Спайк GQL (2026-10-30)
- Токен нашего OAuth-приложения gql.twitch.tv отвергает: 401 "token is invalid".
- Raw-запросы к gql.twitch.tv работают, схема принимает поля currentUser.dropCampaigns / inventory / dropCampaign(id).
- Device code flow работает с client_id Twitch TV (`ue6666qo983tsx6so1t0vnawi233wa`) → подключение аккаунта переводим на device flow, OAuth-флоу удалён (бэкап: projects/_backups/twitch-collector-pre-device-flow-2026-10-30.tar.gz).

## Этап 3. Каталог и прогресс
- [x] ~~Device flow: /api/twitch/device + /poll, зашифрованная cookie с device_code (тесты)~~; вручную: код выдаётся, poll → pending
- [x] ~~GQL-клиент (retry, таймаут 5 с, 429, refresh на 401) + парсер с тестами на синтетической fixture~~
- [x] ~~sync.ts: блокировка, upsert, sync_runs, retention~~ (вручную: старый OAuth-токен → 401 → refresh отклонён → expired, лок снят)
- [x] ~~/api/internal/sync, /api/accounts/[id]/sync, /progress, /api/campaigns~~ (проверено на next start)
- [x] ~~Отключение аккаунта = revoke (токены null, progress сохраняется)~~
- [x] ~~.github/workflows: sync.yml и ci.yml~~ (нужны secrets APP_URL, CRON_SECRET)
- [x] ~~Живая проверка: аккаунт подключён через device flow, sync записал 92 дропса (65 drop, 27 badge), ~3.3 с~~
- [x] ~~Обход гейта: dropCampaigns/dropCampaign(id) с 2026-09 закрыты integrity (null без ошибки). Кампании ищем через live-стримы DROPS_ENABLED → channel.viewerDropCampaigns (там же self-прогресс); inventory → полученные награды. Реальный дамп: src/lib/__fixtures__/drops-sources.real.json~~
- Ограничение: кампания видна, только пока есть live-стрим с ней; уже найденные остаются в БД с fetched_at. Токен mobile web GQL не принимает (401).

## Этап 4. UI
- [x] ~~Навигация, дашборд на /, /accounts (подключение, статусы, обновить, отключить)~~
- [x] ~~/accounts/[id] прогресс, /catalog с фильтрами, SWR polling 60 с~~
- [x] ~~build зелёный, страницы отдают 200 на next start~~
- [x] ~~Визуальная проверка в браузере (телефон/десктоп) с реальными данными~~ (2026-10-30, Playwright)
- [ ] Деплой: Vercel env, миграции, GitHub secrets, первый коммит (см. README)

## Этап 5. Статистика, планировщик, ИИ, админка (2026-10-30)
- [x] ~~Миграция 0003: campaigns.campaign_external_id/account_link_url, progress.account_connected, users.is_admin,
      таблицы progress_history, rewards, live_channels, ai_messages~~ (применена к dev-базе Neon)
- [x] ~~drops.ts: поля кампании (id, accountLinkURL, self.isAccountConnected), live-каналы по кампаниям, награды из gameEventDrops (тесты)~~
      Ссылка `https://www.twitch.tv/` = заглушка «привязка не нужна»; у значков привязка не нужна.
- [x] ~~sync.ts: история прогресса при изменении, upsert наград и live-каналов~~ (живой sync: 41 канал, 7 наград, ~3.7 с)
- [x] ~~lib/stats.ts (чистые функции + тесты): минуты по дням, награды по дням, разбивка по играм, риск дедлайна, планировщик~~
- [x] ~~API: /api/stats, /api/plan, /api/ai (сводка + вопрос, лимит, кэш), /api/admin/users~~ (curl на dev; ИИ живьём не проверен — нет ключа)
- [x] ~~UI: /stats с графиками, «Что смотреть сейчас» на дашборде, где смотреть / привязка аккаунта в строке прогресса,
      история наград на странице аккаунта, /admin, ИИ-панель, поиск в каталоге~~ (скриншоты Playwright: десктоп светлая + телефон тёмная, без переполнения и ошибок консоли)
- [x] ~~Проверка: тесты (55)/typecheck/lint/build, живой sync, ответы API на dev~~
- [x] ~~ИИ-советник удалён по решению владельца (2026-10-30): модуль, /api/ai, панель, SDK; миграция 0004 удаляет ai_messages
      (применена к dev-базе; тесты 52/typecheck/lint/build зелёные)~~
- [ ] График минут наполнится после реального просмотра (история пишется с 2026-10-30)
- [ ] Деплой: + миграции 0003–0004 на боевую базу, первый админ `npm run user:create -- --name ... --admin`

## Этап 6. Автосбор (2026-10-30)
Протокол сверен с TwitchDropsMiner (забор, HLS) и Twitch-Channel-Points-Miner-v2 (стрик, spade, лимит 2 канала).
- [x] ~~Спайк: raw GQL с TV-токеном без integrity — claimDropRewards (на чужой id → null), streamPlaybackAccessToken (с user_id),
      usher → плейлист → HEAD чанка 200, spade_url из settings.js, minute-watched → 204~~
- [ ] **Минуты дропсов от нашего просмотра НЕ растут (TV-токен).** Первые прогоны загрязнены: пользователь смотрел MW4 в браузере.
      Чистый прогон 2026-10-30 00:22–00:43 UTC: воркер 21 мин на roier (GTA IV) — «GTA IV Melissa 1» 0/60, MW4 стоит на месте.
      Гипотеза: Twitch не засчитывает просмотр с client id Twitch TV. Следующий шаг — 15-мин тест с токеном Android-клиента
      (kd1unb4b3q4t58fwlpcbzcbnm76a8fp; у TDM — вход через twitch.tv/login в браузере, токен из #access_token; device flow → invalid client).
- [x] ~~Автозабор в sync: self.dropInstanceID (fallback userId#campaignId#dropId), claimed только по ELIGIBLE_FOR_ALL / ALREADY_CLAIMED~~
      (код + тесты; живьём не забирал: готовые MW4 без привязки Activision пропущены, как задумано)
- [x] ~~Миграция 0005: twitch_accounts.auto_watch / watching / watching_at, таблица streak_channels~~ (применена к dev-базе)
- [x] ~~src/lib/watch.ts + src/lib/worker.ts + scripts/worker.mts (`npm run worker`), тесты чистых функций (64 зелёных)~~
- [x] ~~API: PATCH /api/accounts/[id] {autoWatch}, /api/streaks (GET/POST), DELETE /api/streaks/[id]~~ (curl на next start, вкл. ошибки и чужой аккаунт)
- [x] ~~UI: переключатель автопросмотра и «сейчас смотрит» на /accounts, вкладка /streaks~~ (build зелёный; скриншоты не сняты — Playwright не установился)
- [x] ~~Живой прогон воркера: стрик geega — 420 с за 7 мин, слот освобождён; 2 слота (дропсы + стрик); Ctrl+C очищает watching~~
- [ ] Хостинг воркера (позже): Vercel не подходит (60 с), GitHub Actions — job до 6 ч по cron
- Слоты: на аккаунт 2 канала одновременно — дропсы + стрик. Стрик: ≥7 мин просмотра за эфир (по TCPM), подтверждения от Twitch нет.
- Риск: автопросмотр нарушает правила Twitch, возможны баны аккаунтов/дропсов

## Этап 7. Редизайн по Claude Design (2026-10-30)
Макет: вариант 1c «Шкала сроков» (handoff «Три направления для экрана Обзор»), палитра Nocturne на весь сайт.
- [x] ~~Токены Nocturne (тёмная/светлая) в globals.css как цвета Tailwind, Inter, контурные кнопки; ui.tsx и шапка~~
- [x] ~~Перевести все страницы с zinc/violet/emerald/amber/red/sky на токены~~
- [x] ~~«Пропустить»: миграция 0006 skipped_campaigns (применена к dev-базе), POST/DELETE /api/accounts/[id]/skipped, фильтр в plan() (тест)~~
      (curl на next start: skip/повтор/вернуть 204, чужой аккаунт 404, пустое тело 400)
- [x] ~~«Забрать» = POST /api/accounts/[id]/sync (sync сам забирает готовые дропсы)~~ (живьём не нажимал)
- [ ] Обзор 1c: итоги, «сейчас смотрит» (сегменты), шкала 8 ч, «позже», «забрать и привязать», аккаунты; телефон
- [ ] Проверка: тесты/typecheck/lint/build, скриншоты тёмная/светлая, десктоп/телефон

## Дропсы за подписку (2026-10-30)
- [x] ~~GQL: `timeBasedDrops.requiredSubs`, `self.currentSubs` (живьём: «GTA IV Melissa 1» = 1 подписка/0 мин, «Melissa 2» = 60 мин в той же кампании)~~
- [x] ~~Миграция 0007: campaigns.required_subs, progress.subs_current (применена к dev-базе); парсер, sync, earned()/isReady по подпискам, автозабор~~
- [x] ~~UI: «за подписку или подарочную подписку» и «N / M подписка» в строке прогресса, каталоге, аккаунтах; на шкале сроков иконка и имя награды за просмотр + строка наград за подписку~~
      (тесты 77/typecheck/lint/build зелёные, живой sync: 13 sub-дропов; скриншотов нет)

## Сторож прогресса воркера (2026-10-30)
- Факт: с 00:22 UTC (конец просмотра в браузере) воркер не дал ни минуты ни одному дропу, хотя heartbeat идёт. У Melissa 2 по GQL 60 мин/0 подписок, preconditions нет; summary: includesSubRequirement и includesMWRequirement = true.
- [x] ~~Миграция 0008: skipped_campaigns.reason (user | no_progress), применена к dev-базе; на дашборде «(просмотр не засчитывается)»~~
- [x] ~~worker.ts: базовая линия минут кампании при старте, каждые 20 мин sync + сравнение; не выросло → пропуск no_progress, переключение. Воркер теперь учитывает пропуски пользователя (раньше plan() без skipped)~~
      (тесты 79/typecheck/lint/build зелёные; живьём сторож не прогонялся — нужен перезапуск воркера)

## Этап 8. Понятный интерфейс и адаптивный воркер (2026-10-30)
Проблемы (скриншоты 2026-10-30): главная показывает «2 можно забрать» без кнопки (награды требуют привязки), 3 из 36 привязок без счётчика,
шкала сроков без легенды, страница аккаунта — 27 000 px плоского списка, «Стрики» без объяснения, статус воркера и «npm run worker» на экране пользователя,
на телефоне главная даёт горизонтальный скролл.
- [x] ~~Воркер: миграция 0009 `worker_status` (применена к dev-базе), аккаунты параллельно, backoff ошибок по аккаунту, ротация канала при стопоре и кулдаун 3 ч вместо вечного пропуска,
      sync по ETA награды, TTL оффлайн-каналов, терпимость к 2 сбоям подряд, частый replan при ожидании стримера, статус простым языком (тесты 93)~~
- [x] ~~API: workerStatus в /api/accounts, все привязки в /api/plan, кулдаун пропусков (`loadSkipped`)~~
- [x] ~~UI: навигация и тексты, главная «статус → что сделать → смотрит сейчас → что успеть», онбординг, /help, аккаунты с переключателем и статусом воркера,
      серии просмотра, страница аккаунта по разделам~~ (скриншоты Playwright десктоп/телефон: без горизонтального скролла и ошибок консоли)
- [x] ~~Проверка: тесты/typecheck/lint/build зелёные~~
- [ ] Воркер живьём с новой логикой НЕ прогонялся (автопросмотр трогает реальный аккаунт): перезапустить `npm run worker` и смотреть лог на «trying another channel» / «skipping for a while»
- [ ] Гипотеза: 10-минутное первое окно сторожа достаточно, чтобы увидеть прирост минут (если Twitch считает просмотр)
- Второй слот воркера под вторую кампанию дропсов не делали: неизвестно, считает ли Twitch дропсы на двух каналах сразу (гипотеза, не проверено)
