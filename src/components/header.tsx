"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/client";

const LINKS = [
  { href: "/", label: "Главная" },
  { href: "/accounts", label: "Аккаунты" },
  { href: "/catalog", label: "Все награды" },
  { href: "/streaks", label: "Серии просмотра" },
  { href: "/stats", label: "Статистика" },
  { href: "/help", label: "Как это работает" },
] as const;

export type Section = (typeof LINKS)[number]["href"] | "/admin";

function Mark() {
  return <span className="size-2.5 shrink-0 rotate-45 rounded-[3px] bg-acc" aria-hidden />;
}

export function Header({ section }: { section: Section }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data } = useSWR<{ user: { name: string; isAdmin: boolean } }>("/api/me", fetcher);
  const links = [...LINKS, ...(data?.user.isAdmin ? [{ href: "/admin" as const, label: "Админ" }] : [])];
  const current = links.find((l) => l.href === section)?.label ?? "Главная";

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-10 bg-bg/90 backdrop-blur">
      {/* Desktop: brand, text tabs with an accent underline, user on the right. */}
      <nav className="mx-auto hidden max-w-7xl items-center gap-7 px-10 py-4 sm:flex">
        <span className="flex items-center gap-2 text-base font-semibold">
          <Mark />
          Дропсы
        </span>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-mut">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={section === l.href ? "page" : undefined}
              className={`pb-1 hover:text-fg ${section === l.href ? "text-fg shadow-[inset_0_-2px_0_var(--acc)]" : ""}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <span className="ml-auto text-[13px] text-mut">{data?.user.name}</span>
        <button className="text-[13px] text-mut hover:text-fg" onClick={logout}>
          Выйти
        </button>
      </nav>
      {/* Phone: current section and a menu button. */}
      <div className="sm:hidden">
        <div className="flex items-center gap-2.5 px-4 py-3.5">
          <Mark />
          <span className="text-[15px] font-semibold">{current}</span>
          <button className="-m-2 ml-auto p-2 text-mut" aria-label="Меню" aria-expanded={open} onClick={() => setOpen(!open)}>
            <svg width="22" height="22" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" aria-hidden>
              <path d="M40 72h176M40 128h176M40 184h176" />
            </svg>
          </button>
        </div>
        {open && (
          <nav className="flex flex-col border-b border-line px-4 pb-3">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`py-2.5 text-[15px] ${section === l.href ? "text-acc-t" : "text-fg"}`}
              >
                {l.label}
              </Link>
            ))}
            <button className="py-2.5 text-left text-[15px] text-mut" onClick={logout}>
              Выйти{data?.user.name ? ` (${data.user.name})` : ""}
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
