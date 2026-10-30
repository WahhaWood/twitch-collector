"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { errorText } from "@/lib/format";
import { Button, Card, ErrorBox } from "./ui";

type Device = { userCode: string; verificationUri: string; expiresIn: number; interval: number };
type State =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "waiting"; device: Device }
  | { step: "done" }
  | { step: "error"; message: string };

const message = (e: unknown) => (e instanceof ApiError ? errorText(e.code) : errorText(""));

export function ConnectTwitch({ disabled, onConnected }: { disabled?: boolean; onConnected: () => void }) {
  const [state, setState] = useState<State>({ step: "idle" });

  async function start() {
    setState({ step: "starting" });
    try {
      setState({ step: "waiting", device: await api<Device>("/api/twitch/device", { method: "POST" }) });
    } catch (e) {
      setState({ step: "error", message: message(e) });
    }
  }

  const device = state.step === "waiting" ? state.device : null;
  useEffect(() => {
    if (!device) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await api<{ status: string }>("/api/twitch/device/poll", { method: "POST" });
        if (cancelled) return;
        if (res.status === "pending") {
          timer = setTimeout(poll, device.interval * 1000);
          return;
        }
        setState({ step: "done" });
        onConnected();
      } catch (e) {
        if (!cancelled) setState({ step: "error", message: message(e) });
      }
    };
    timer = setTimeout(poll, device.interval * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [device, onConnected]);

  if (device) {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-sm">
          Откройте страницу активации Twitch, войдите в нужный аккаунт и введите код:
        </p>
        <p className="select-all text-center font-mono text-3xl font-bold tracking-widest text-acc-t">{device.userCode}</p>
        <div className="flex flex-wrap gap-2">
          <a
            href={device.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-acc px-3 py-2 text-sm font-medium text-white hover:bg-acc"
          >
            Открыть twitch.tv/activate
          </a>
          <Button onClick={() => setState({ step: "idle" })}>Отмена</Button>
        </div>
        <p className="text-xs text-mut">Ждём подтверждения… Код действует {Math.round(device.expiresIn / 60)} мин.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" className="self-start" disabled={disabled || state.step === "starting"} onClick={start}>
        {state.step === "starting" ? "Получаем код…" : "Подключить Twitch"}
      </Button>
      {state.step === "done" && <p className="text-sm text-ok">Аккаунт подключён, данные загружены.</p>}
      {state.step === "error" && <ErrorBox>{state.message}</ErrorBox>}
    </div>
  );
}
