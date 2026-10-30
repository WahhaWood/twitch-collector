export type ProgressStatus = "not_started" | "in_progress" | "claimed" | "expired" | "unknown";
export type AccountStatus = "pending" | "active" | "expired" | "revoked" | "error";

export const PROGRESS_LABEL: Record<ProgressStatus, string> = {
  not_started: "не начато",
  in_progress: "в процессе",
  claimed: "получено",
  expired: "истекло",
  unknown: "нет данных",
};

export const ACCOUNT_LABEL: Record<AccountStatus, string> = {
  pending: "ожидает",
  active: "активен",
  expired: "нужно переподключить",
  revoked: "отключён",
  error: "ошибка синхронизации",
};

const ERROR_TEXT: Record<string, string> = {
  account_limit: "Достигнут лимит: не больше 5 аккаунтов",
  account_taken: "Этот Twitch-аккаунт уже подключён другим пользователем",
  device_expired: "Код подключения истёк, начните заново",
  twitch_error: "Twitch не ответил, попробуйте позже",
  too_soon: "Обновляли меньше минуты назад",
  reconnect_required: "Сначала подключите аккаунт заново",
  sync_in_progress: "Синхронизация уже идёт",
  token_expired: "Токен истёк, подключите аккаунт заново",
  rate_limited: "Twitch ограничил запросы, попробуйте позже",
  unavailable: "Twitch недоступен, попробуйте позже",
  bad_response: "Twitch вернул неожиданный ответ",
  bad_login: "Неверный логин Twitch",
  channel_not_found: "Такого канала на Twitch нет",
  streak_exists: "Этот канал уже в списке",
  streak_limit: "Слишком много каналов на одном аккаунте",
  name_taken: "Пользователь с таким именем уже есть",
  self_demote: "Нельзя снять права администратора с себя",
  self_delete: "Нельзя удалить самого себя",
  forbidden: "Только для администратора",
};

export function errorText(code: string, fallback = "Что-то пошло не так"): string {
  return ERROR_TEXT[code] ?? fallback;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function timeAgo(value: string | Date | null, now = Date.now()): string {
  if (!value) return "никогда";
  const diff = now - new Date(value).getTime();
  if (diff < MIN) return "только что";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} мин назад`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} ч назад`;
  return `${Math.floor(diff / DAY)} дн назад`;
}

export function timeLeft(value: string | Date | null, now = Date.now()): string | null {
  if (!value) return null;
  const diff = new Date(value).getTime() - now;
  if (diff <= 0) return "закончилось";
  if (diff < HOUR) return `ещё ${Math.max(1, Math.floor(diff / MIN))} мин`;
  if (diff < 2 * DAY) return `ещё ${Math.floor(diff / HOUR)} ч`;
  return `ещё ${Math.floor(diff / DAY)} дн`;
}

export function minutesText(watched: number | null, required: number | null): string {
  const w = watched ?? "?";
  return required ? `${w} / ${required} мин` : watched === null ? "—" : `${watched} мин`;
}

export function subsText(current: number | null, required: number): string {
  return `${current ?? "?"} / ${required} ${required === 1 ? "подписка" : "подписок"}`;
}

// Twitch counts both an own sub and a gifted one on a campaign channel.
export const SUB_HINT = "за подписку или подарочную подписку";

// Bar fill in percent; null when there is nothing honest to show (unknown is never drawn as full).
export function percent(watched: number | null, required: number | null, status: ProgressStatus): number | null {
  if (status === "claimed") return 100;
  if (status === "unknown" || watched === null || !required) return null;
  return Math.min(100, Math.max(0, Math.round((watched / required) * 100)));
}

export function durationText(minutes: number | null): string {
  if (minutes === null) return "—";
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h >= 48 && rest === 0) return `${h} ч`;
  return rest ? `${h} ч ${rest} мин` : `${h} ч`;
}

const DAY_FMT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });

// "2026-10-30" (a day key already in the viewer's zone) → "30 окт."
export function dayLabel(day: string): string {
  return DAY_FMT.format(new Date(`${day}T00:00:00Z`));
}

export function dateTimeText(value: string | Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function percentText(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

const COMPACT = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
export const compactNumber = (n: number) => COMPACT.format(n);

// Russian plural form: plural(1, "награда", "награды", "наград") → "награда".
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Big minute counts as hours: 18171 → "303 ч".
export function hoursText(minutes: number): string {
  return minutes >= 120 ? `${Math.round(minutes / 60)} ч` : `${minutes} мин`;
}
