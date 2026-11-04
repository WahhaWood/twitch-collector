// Telegram alert for things the worker cannot fix itself. No-op unless both env vars are set.
export async function notify(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // an alert must never break the worker; never log the URL (it holds the bot token)
  }
}
