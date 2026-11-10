import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { deletePaymentToken } from "@/lib/paypal";
import { archiveCurrentWallet, log, state, withState } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Unclip the leash: delete the saved payment token at PayPal. */
export const POST = withState(async function POST() {
  try {
    const s = state();
    if (s.wallet.vaultId) await deletePaymentToken(s.wallet.vaultId);
    log("paypal", "PayPal wallet disconnected. Saved payment token deleted.");
    const who = archiveCurrentWallet();
    if (who) log("paypal", `Disconnected ${who}. Their history is saved and comes back when that account reconnects.`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, 500);
  }
});
