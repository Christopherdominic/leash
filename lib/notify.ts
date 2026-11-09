/**
 * Optional phone push for approval requests via ntfy.sh (free, no account).
 * Install the ntfy app, subscribe to a hard-to-guess topic, and set NTFY_TOPIC.
 */
export async function notifyPhone(title: string, message: string, appUrl: string) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: { Title: title, Tags: "dog,money_with_wings", Click: appUrl, Priority: "high" },
      body: message,
    });
  } catch {
    // Notifications are best-effort; the in-app inbox is the source of truth.
  }
}
