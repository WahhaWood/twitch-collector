"use client";

import { useState } from "react";
import { type Account, api, ApiError } from "@/lib/client";
import { WATCH_AUTH_URL } from "@/lib/watch-token";
import { Button, ErrorBox } from "./ui";

// Second Twitch login, for watching only: Twitch counts drops minutes for this login and not for the first one.
export function WatchLogin({ account, onChange }: { account: Account; onChange: () => unknown }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/accounts/${account.id}/watch-token`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ input }) } : {}),
      });
      setInput("");
      await onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не получилось сохранить, попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  if (account.watchLinked) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
        <span className="size-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <span className="font-medium text-ok">Вход для дропсов выполнен</span>
        <Button variant="secondary" onClick={() => send("DELETE")} disabled={busy} className="sm:ml-auto">
          Сбросить
        </Button>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
      <div className="font-medium text-warn">Нужен ещё один вход, иначе дропсы не набираются</div>
      <p className="text-xs text-mut">
        Twitch засчитывает минуты дропсов только за просмотр с обычным входом на twitch.tv. Пароль мы не видим: вход происходит на сайте Twitch.
      </p>
      <ol className="list-decimal pl-5 text-xs text-mut">
        <li>
          Нажмите «Войти через Twitch» и войдите в <b>{account.displayName}</b> (если уже вошли, Twitch просто перенаправит).
        </li>
        <li>Когда страница загрузится, скопируйте адрес из строки браузера целиком и вставьте ниже.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={WATCH_AUTH_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-fg/7"
        >
          Войти через Twitch
        </a>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Адрес страницы после входа"
          aria-label="Адрес страницы Twitch после входа"
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
        />
        <Button onClick={() => send("POST")} disabled={busy || !input.trim()}>
          {busy ? "Проверяем…" : "Сохранить"}
        </Button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
