/**
 * Optional phone push for approval requests via ntfy (free).
 * Install the ntfy app, subscribe to a hard-to-guess topic, and set NTFY_TOPIC.
 * NTFY_TOKEN (optional) sends as a logged-in ntfy user, which avoids the shared
 * per-IP limits that cloud hosts like Render can hit. NTFY_SERVER defaults to ntfy.sh.
 *
 * Returns an error message if the alert couldn't be sent, so callers can log it.
 */
export async function notifyPhone(title: string, message: string, appUrl: string): Promise<string | null> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return null;
  const server = (process.env.NTFY_SERVER ?? "https://ntfy.sh").replace(/\/$/, "");
  try {
    const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        // Headers must be plain ASCII; product titles go in the body instead.
        Title: title.replace(/[^\x20-\x7e]/g, ""),
        Tags: "dog,money_with_wings",
        Click: appUrl,
        Priority: "high",
        ...(process.env.NTFY_TOKEN ? { Authorization: `Bearer ${process.env.NTFY_TOKEN}` } : {}),
      },
      body: message,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return `ntfy answered ${res.status}: ${(await res.text()).slice(0, 160)}`;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
