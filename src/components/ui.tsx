import type { ComponentProps, ReactNode } from "react";
import type { AccountStatus, ProgressStatus } from "@/lib/format";
import { ACCOUNT_LABEL, PROGRESS_LABEL } from "@/lib/format";

const BUTTON = {
  // Nocturne: the primary action is an accent outline, never a fill.
  primary: "border border-acc text-acc-t hover:bg-acc/12 active:bg-acc/22",
  secondary: "border border-line text-fg hover:bg-fg/7 active:bg-fg/14",
  danger: "border border-transparent text-bad hover:bg-bad-bg",
};

export function Button({ variant = "secondary", className = "", ...props }: ComponentProps<"button"> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${BUTTON[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      className={`rounded-lg border border-line bg-sf p-4 ${className}`}
      {...props}
    />
  );
}

const PROGRESS_TONE: Record<ProgressStatus, string> = {
  in_progress: "bg-run-bg text-run",
  claimed: "bg-ok-bg text-ok",
  not_started: "bg-sf2 text-mut",
  expired: "bg-bad-bg text-bad",
  unknown: "border border-dashed border-mut text-mut",
};

const ACCOUNT_TONE: Record<AccountStatus, string> = {
  active: "bg-ok-bg text-ok",
  pending: "bg-sf2 text-mut",
  expired: "bg-warn-bg text-warn",
  revoked: "bg-sf2 text-mut",
  error: "bg-bad-bg text-bad",
};

export function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{children}</span>;
}

export function ProgressBadge({ status, ready }: { status: ProgressStatus; ready?: boolean }) {
  if (ready) return <Pill tone="bg-acc-bg text-acc-t">можно забрать</Pill>;
  return <Pill tone={PROGRESS_TONE[status]}>{PROGRESS_LABEL[status]}</Pill>;
}

// Status dot: shape, colour and label differ together. "Нет данных" is a dashed empty ring, never a filled one.
const DOT: Record<ProgressStatus | "ready", string> = {
  not_started: "border-mut",
  in_progress: "border-run bg-[linear-gradient(90deg,var(--run)_50%,transparent_50%)]",
  ready: "border-acc bg-acc",
  claimed: "border-ok bg-ok",
  expired: "border-bad",
  unknown: "border-dashed border-mut",
};

export function StatusDot({ status }: { status: ProgressStatus | "ready" }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full border-[1.5px] ${DOT[status]}`} aria-hidden />;
}

export function AccountBadge({ status }: { status: AccountStatus }) {
  return <Pill tone={ACCOUNT_TONE[status]}>{ACCOUNT_LABEL[status]}</Pill>;
}

export function KindBadge({ kind }: { kind: "drop" | "badge" }) {
  return <Pill tone="bg-run-bg text-run">{kind === "badge" ? "значок" : "дропс"}</Pill>;
}

export function ProgressBar({ value, muted }: { value: number | null; muted?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={value ?? undefined}>
      {value !== null && (
        <div
          className={`h-full rounded-full ${muted ? "bg-bad" : value >= 100 ? "bg-ok" : "bg-acc"}`}
          style={{ width: `${value}%` }}
        />
      )}
    </div>
  );
}

export function Thumb({ src, alt, size = "md" }: { src: string | null; alt: string; size?: "sm" | "md" }) {
  const box = size === "sm" ? "size-9" : "size-12";
  if (!src) return <div className={`${box} shrink-0 rounded-lg bg-track`} />;
  // Twitch CDN images of unknown size; next/image would need remote patterns for every host.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={`${box} shrink-0 rounded-lg bg-track object-cover`} />;
}

export function Segmented<T extends string | number>({ options, value, onChange, label }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 self-start rounded-lg bg-sf2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm ${value === o.value ? "bg-sf font-medium shadow-sm" : "text-mut"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-bad bg-bad-bg px-3 py-2 text-sm text-bad">
      {children}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-sf2" />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-mut">{children}</p>;
}

// Page title with one plain sentence under it saying what the page is for.
export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children && <p className="max-w-2xl text-sm text-mut">{children}</p>}
    </div>
  );
}

const NOTICE: Record<"ok" | "info" | "warn" | "bad", string> = {
  ok: "bg-ok-bg text-ok",
  info: "bg-sf2 text-fg",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
};

// Coloured message box: a bold headline and an optional explanation, with an optional action on the right.
export function Notice({ tone, title, children, action }: { tone: keyof typeof NOTICE; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`flex flex-col gap-2 rounded-lg px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4 ${NOTICE[tone]}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="font-medium">{title}</b>
        {children && <div className={tone === "info" ? "text-mut" : "opacity-90"}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

// On/off switch with a visible label; `busy` freezes it while the request is in flight.
export function Switch({ checked, onChange, busy, label }: { checked: boolean; onChange: (v: boolean) => void; busy?: boolean; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={busy}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${checked ? "border-acc bg-acc/30" : "border-line bg-track"}`}
    >
      <span className={`absolute top-0.5 size-4.5 rounded-full transition-all ${checked ? "left-[22px] bg-acc-t" : "left-0.5 bg-mut"}`} />
    </button>
  );
}

// Tiny inline explanation for jargon: the dotted word shows the meaning on hover / long press.
export function Term({ children, hint }: { children: ReactNode; hint: string }) {
  return (
    <abbr title={hint} className="cursor-help underline decoration-dotted underline-offset-4">
      {children}
    </abbr>
  );
}
