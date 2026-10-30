"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) return router.refresh();
    setError((await res.json().catch(() => null))?.error?.message ?? "Ошибка входа");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Токен"
        autoComplete="off"
        className="rounded-lg border border-line bg-sf px-3 py-2"
      />
      <button type="submit" className="rounded-lg bg-acc px-3 py-2 font-medium text-white hover:bg-acc">
        Войти
      </button>
      {error && <p className="text-sm text-bad">{error}</p>}
    </form>
  );
}
