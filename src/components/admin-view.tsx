"use client";

import { useState } from "react";
import useSWR from "swr";
import { type AdminUser, api, ApiError, fetcher } from "@/lib/client";
import { errorText, timeAgo } from "@/lib/format";
import { useNow } from "./progress-row";
import { Button, Card, ErrorBox, Pill, Skeleton } from "./ui";

const message = (e: unknown) => (e instanceof ApiError ? errorText(e.code) : errorText(""));

function TokenBox({ name, token, onClose }: { name: string; token: string; onClose: () => void }) {
  return (
    <Card className="flex flex-col gap-2 border-acc">
      <p className="text-sm">
        Токен для <b>{name}</b>. Показывается один раз, передайте его лично:
      </p>
      <code className="select-all break-all rounded-lg bg-sf2 px-3 py-2 font-mono text-sm">{token}</code>
      <div className="flex gap-2">
        <Button onClick={() => navigator.clipboard?.writeText(token)}>Скопировать</Button>
        <Button onClick={onClose}>Готово</Button>
      </div>
    </Card>
  );
}

export function AdminView() {
  const { data, error, mutate } = useSWR<{ users: AdminUser[] }>("/api/admin/users", fetcher);
  const now = useNow();
  const [name, setName] = useState("");
  const [admin, setAdmin] = useState(false);
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorBox>{error instanceof ApiError && error.status === 403 ? "Только для администратора" : "Не удалось загрузить пользователей"}</ErrorBox>;
  if (!data) return <Skeleton />;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    try {
      await fn();
    } catch (e) {
      setFailure(message(e));
    } finally {
      setBusy(false);
      await mutate();
    }
  }

  const create = () =>
    run(async () => {
      const res = await api<{ user: { name: string }; token: string }>("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), isAdmin: admin }),
      });
      setIssued({ name: res.user.name, token: res.token });
      setName("");
      setAdmin(false);
    });

  const patch = (u: AdminUser, body: object) =>
    run(async () => {
      const res = await api<{ token: string | null }>(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.token) setIssued({ name: u.name, token: res.token });
    });

  const remove = (u: AdminUser) => {
    if (!confirm(`Удалить ${u.name}? Вместе с ним удалятся его Twitch-аккаунты и прогресс.`)) return;
    return run(() => api(`/api/admin/users/${u.id}`, { method: "DELETE" }));
  };

  return (
    <div className="flex flex-col gap-4">
      {issued && <TokenBox {...issued} onClose={() => setIssued(null)} />}
      <Card>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Имя нового пользователя"
            maxLength={60}
            className="min-w-0 flex-1 rounded-lg border border-line bg-sf px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-1.5 text-sm text-mut">
            <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
            админ
          </label>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            Создать и выдать токен
          </Button>
        </form>
      </Card>
      {failure && <ErrorBox>{failure}</ErrorBox>}
      <Card className="divide-y divide-line py-1">
        {data.users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-2 py-3">
            <span className="font-medium">{u.name}</span>
            {u.isAdmin && <Pill tone="bg-acc-bg text-acc-t">админ</Pill>}
            <span className="text-xs text-mut">
              аккаунтов: {u.accounts} · синхронизация {timeAgo(u.lastSyncedAt, now)}
            </span>
            <div className="ml-auto flex gap-1">
              <Button onClick={() => patch(u, { reissueToken: true })} disabled={busy}>
                Новый токен
              </Button>
              <Button onClick={() => patch(u, { isAdmin: !u.isAdmin })} disabled={busy}>
                {u.isAdmin ? "Снять админа" : "Сделать админом"}
              </Button>
              <Button variant="danger" onClick={() => remove(u)} disabled={busy}>
                Удалить
              </Button>
            </div>
          </div>
        ))}
      </Card>
      <p className="text-xs text-mut">Новый токен сразу отключает старый. Токены не хранятся, только их хэши.</p>
    </div>
  );
}
