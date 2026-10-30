"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client";
import { errorText } from "@/lib/format";

// Manual sync of one account; `onDone` runs after success and failure alike since the status may change.
export function useSync(accountId: number, onDone: () => unknown) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/accounts/${accountId}/sync`, { method: "POST" });
    } catch (e) {
      setError(e instanceof ApiError ? errorText(e.code, "Не удалось обновить") : "Не удалось обновить");
    } finally {
      setBusy(false);
      await onDone();
    }
  }
  return { busy, error, run };
}
