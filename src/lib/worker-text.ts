// What the worker is doing with an account, in plain Russian for the UI (pure, so the wording is tested).
import { type Account, workerUp } from "./client";

export type WorkerLine = {
  tone: "ok" | "idle" | "warn" | "bad" | "off";
  title: string;
  detail: string | null;
};

const KIND = { drop: "дропсы", streak: "серия просмотра", points: "баллы" } as const;
// With drops off, the worker still watches channels from the «Серии» page: say so, or the switch looks broken.
const DROPS_OFF = "Дропсы не смотрит: автопросмотр дропсов выключен. Эти каналы — со страницы «Серии».";

const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

export function workerLine(a: Pick<Account, "autoWatch" | "watching" | "watchingAt" | "workerStatus">, now: number, hasStreaks = false): WorkerLine {
  const up = workerUp(a, now);
  if (!a.autoWatch && !hasStreaks) return { tone: "off", title: "Автопросмотр выключен", detail: "Награды копятся только если вы сами смотрите стримы." };
  if (!up) {
    return {
      tone: "warn",
      title: "Воркер не запущен",
      detail: "Просмотр стоит. Воркер — отдельная программа, которая смотрит стримы за вас; пока она не запущена, ничего не набегает.",
    };
  }
  const s = a.workerStatus;
  if (s?.state === "error") {
    return {
      tone: "bad",
      title: "Ошибка связи с Twitch",
      detail: `Воркер повторит попытку${s.retryAt ? ` в ${time(s.retryAt)}` : " позже"}${s.detail ? ` (${s.detail})` : ""}.`,
    };
  }
  // A drops channel can linger for a minute after the switch is turned off, until the worker re-reads the account.
  const watching = (a.watching ?? []).filter((w) => a.autoWatch || w.kind !== "drop");
  if (watching.length) {
    const parts = watching.map((w) => `${w.displayName} (${KIND[w.kind]})`);
    return { tone: "ok", title: `Смотрит: ${parts.join(", ")}`, detail: a.autoWatch ? null : DROPS_OFF };
  }
  switch (s?.reason) {
    case "no_campaigns":
      return { tone: "idle", title: "Воркер работает, смотреть пока нечего", detail: `Нет кампаний, которые имеет смысл смотреть (всё получено, пропущено или не успеть).` };
    case "no_live":
      return { tone: "idle", title: "Ждём живые стримы", detail: `Подходящие кампании есть, но канал для них не нашёлся или стример не в эфире. Воркер проверяет каждые несколько минут.${s.detail ? ` Ждут канал: ${s.detail}.` : ""}` };
    case "waiting_streamers":
      return {
        tone: "idle",
        title: a.autoWatch ? "Ждём эфир стримеров из серий" : "Дропсы выключены, ждём эфир стримеров из серий",
        detail: s.detail ? `Не в эфире: ${s.detail}.` : null,
      };
    default:
      return { tone: "idle", title: "Воркер работает", detail: "Определяет, что смотреть." };
  }
}
