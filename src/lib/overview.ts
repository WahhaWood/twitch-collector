// Pure helpers for the overview screen ("Шкала сроков"): the deadline timeline, segmented progress, short labels.

// The timeline covers the next 8 hours.
export const WINDOW_MIN = 8 * 60;

const pct = (v: number) => `${((Math.max(0, Math.min(v, WINDOW_MIN)) / WINDOW_MIN) * 100).toFixed(1)}%`;

// One campaign on the timeline: the bar is the watch time still needed, the flag is the campaign end.
// Whatever does not fit before the flag is drawn hatched past it, clipped at the window edge.
export function timelineBar(remainingMin: number, leftMin: number) {
  return {
    deadline: pct(leftMin),
    fit: pct(Math.min(remainingMin, leftMin)),
    over: pct(Math.max(0, Math.min(remainingMin, WINDOW_MIN) - leftMin)),
  };
}

// Fill of each segment, 0..1; one segment per minute up to 12, so short goals read as countable steps.
export function segments(cur: number, max: number): number[] {
  if (max <= 0) return [];
  const n = Math.min(12, Math.max(1, Math.round(max)));
  const step = max / n;
  return Array.from({ length: n }, (_, i) => Math.max(0, Math.min(1, (cur - i * step) / step)));
}

// "1:05" inside a day, then "3 д"; for the big deadline numbers.
export function leftShort(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m >= 48 * 60) return `${Math.floor(m / 1440)} д`;
  if (m >= 10 * 60) return `${Math.floor(m / 60)} ч`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export function greeting(hour: number): string {
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

// Stable channel colour from its login (the worker does not store avatars).
export function channelHue(login: string): number {
  let h = 0;
  for (const c of login) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
