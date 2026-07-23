/* Telegram notifier for the scheduled engine. Dependency-free: plain fetch
   against the Bot API. Engine/workflow-side ONLY — the token must never
   reach client code.

   Contract: NEVER throws and NEVER fails a run. Missing env vars (local
   runs, forks) log one line and return; a Telegram outage logs and gives
   up after 3 attempts (0s / 1.5s / 3s backoff). */

export async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("telegram: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — alert skipped");
    return;
  }
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 1500));
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok) return;
      console.error(`telegram: sendMessage HTTP ${res.status} (attempt ${attempt + 1}/3)`);
    } catch (e) {
      console.error(
        `telegram: ${e instanceof Error ? e.message : String(e)} (attempt ${attempt + 1}/3)`
      );
    }
  }
  console.error("telegram: giving up — alert dropped (engine run unaffected)");
}
