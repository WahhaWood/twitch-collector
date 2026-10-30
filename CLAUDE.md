# twitch-collector
Next.js (App Router) + TS + Drizzle + Neon. Спека: plan-mvp.md, задачи: Plan.md.
- Проверка: `npm test && npm run typecheck && npm run lint`; миграции: `npm run db:generate`.
- Токены Twitch только в шифрованном виде (src/lib/crypto.ts), не логировать.
- Неизвестный прогресс = `unknown`, никогда не `claimed`.
