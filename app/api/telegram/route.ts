import { NextResponse } from "next/server";
import { appUrl } from "@/lib/http";
import { resolveApproval } from "@/lib/purchase";
import { log, state, withState } from "@/lib/store";
import { linkedChatId, telegramEnabled, tg, webhookSecret } from "@/lib/telegram";

export const dynamic = "force-dynamic";

type Update = {
  message?: { chat: { id: number }; from?: { first_name?: string }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};

const ok = () => NextResponse.json({ ok: true });

/** Telegram webhook: /start links your chat; Approve / Deny buttons decide purchases. */
export const POST = withState(async function POST(req: Request) {
  if (!telegramEnabled() || req.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const update = (await req.json()) as Update;
  const s = state();

  if (update.message) {
    const chatId = String(update.message.chat.id);
    const text = (update.message.text ?? "").trim();
    const linked = linkedChatId();
    const reply = (t: string) => tg("sendMessage", { chat_id: chatId, text: t }).catch(() => {});

    if (text.startsWith("/start")) {
      if (!linked) {
        s.telegram = { chatId, name: update.message.from?.first_name };
        log("policy", `Telegram linked${s.telegram.name ? ` (${s.telegram.name})` : ""}. Approval requests will be sent there.`);
        await reply("🦮 Linked to Leash. When your shopping agent wants to buy something over your auto-approve limit, you'll get it here with Approve and Deny buttons.");
      } else if (linked === chatId) {
        await reply("You're already linked. Approval requests will appear here.");
      } else {
        await reply("This Leash is already linked to another Telegram chat.");
      }
    } else if (text.startsWith("/stop") && linked === chatId && !process.env.TELEGRAM_CHAT_ID) {
      s.telegram = {};
      log("policy", "Telegram unlinked. Approval requests will only appear in the dashboard.");
      await reply("Unlinked. Send /start to link again.");
    } else if (linked === chatId) {
      await reply("I'll message you here when a purchase needs your approval. Send /stop to unlink.");
    }
    return ok();
  }

  const cb = update.callback_query;
  if (cb?.data) {
    const answer = (t: string) => tg("answerCallbackQuery", { callback_query_id: cb.id, text: t }).catch(() => {});
    // Only the linked chat may approve or deny.
    if (String(cb.message?.chat.id) !== linkedChatId()) {
      await answer("This chat isn't allowed to approve purchases.");
      return ok();
    }
    const [action, id] = cb.data.split(":");
    try {
      const r = await resolveApproval(id, action === "a", appUrl(req));
      await answer(
        action !== "a" ? "Denied" : "result" in r && r.result?.outcome === "PURCHASED" ? "Approved and paid ✅" : r.error ? "Couldn't buy it" : "Approved",
      );
    } catch (e) {
      await answer(e instanceof Error ? e.message : "Something went wrong");
    }
  }
  return ok();
});
