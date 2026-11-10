import { createHash } from "node:crypto";
import { state } from "./store";
import type { Approval } from "./types";

/**
 * Telegram approvals: when a purchase needs your OK, your bot sends the product
 * with Approve & pay / Deny buttons. Tapping a button calls /api/telegram (a
 * webhook), which runs the same approval code as the dashboard.
 *
 * Setup: create a bot with @BotFather, set TELEGRAM_BOT_TOKEN, register the
 * webhook (see README), then send /start to your bot to link your chat. Only
 * that chat can approve. TELEGRAM_CHAT_ID (optional) pins the chat instead.
 */

export function telegramEnabled() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/** Secret Telegram sends back on every webhook call, derived from the bot token. */
export function webhookSecret() {
  return createHash("sha256").update(`leash-webhook:${process.env.TELEGRAM_BOT_TOKEN ?? ""}`).digest("hex").slice(0, 32);
}

export function linkedChatId(): string | undefined {
  return process.env.TELEGRAM_CHAT_ID || state().telegram.chatId;
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
  return data.result as T;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const price = (a: Approval) => `${a.product.currency === "USD" ? "$" : a.product.currency + " "}${a.product.price.toFixed(2)}`;

function approvalText(a: Approval, status?: string) {
  return [
    `<b>${status ? "Purchase request" : `Approve ${price(a)}?`}</b>`,
    `${esc(a.product.title)} · <b>${price(a)}</b>`,
    a.product.merchant ? esc(a.product.merchant) : "",
    "",
    `<i>${esc(a.reasons.join(" "))}</i>`,
    status ? `\n${status}` : "",
  ]
    .filter((l, i) => l !== "" || i === 3)
    .join("\n");
}

/** Send an approval request with buttons. Returns an error message, or null if sent (or Telegram isn't set up). */
export async function sendApprovalRequest(a: Approval, appUrl: string): Promise<string | null> {
  if (!telegramEnabled()) return null;
  const chatId = linkedChatId();
  if (!chatId) return "Telegram isn't linked yet. Send /start to your bot.";
  const buttons: { text: string; callback_data?: string; url?: string }[][] = [
    [
      { text: "✅ Approve & pay", callback_data: `a:${a.id}` },
      { text: "✋ Deny", callback_data: `d:${a.id}` },
    ],
  ];
  if (appUrl.startsWith("https://")) buttons.push([{ text: "Open Leash", url: appUrl }]);
  const common = { chat_id: chatId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } };
  try {
    let msg: { message_id: number } | undefined;
    if (a.product.image) {
      msg = await tg<{ message_id: number }>("sendPhoto", { ...common, photo: a.product.image, caption: approvalText(a) }).catch(() => undefined);
      if (msg) a.telegram = { chatId, messageId: msg.message_id, photo: true };
    }
    if (!msg) {
      msg = await tg<{ message_id: number }>("sendMessage", { ...common, text: approvalText(a) });
      a.telegram = { chatId, messageId: msg.message_id, photo: false };
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** After an approval is decided (in Telegram or the dashboard), show the outcome and remove the buttons. */
export async function showApprovalOutcome(a: Approval, status: string) {
  if (!telegramEnabled() || !a.telegram) return;
  const { chatId, messageId, photo } = a.telegram;
  const body = { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } };
  try {
    if (photo) await tg("editMessageCaption", { ...body, caption: approvalText(a, status) });
    else await tg("editMessageText", { ...body, text: approvalText(a, status) });
  } catch {
    // Best effort: the dashboard is the source of truth.
  }
}
