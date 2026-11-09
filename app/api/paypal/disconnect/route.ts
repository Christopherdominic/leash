import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { deletePaymentToken } from "@/lib/paypal";
import { log, state } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Unclip the leash: delete the saved payment token at PayPal. */
export async function POST() {
  try {
    const s = state();
    if (s.wallet.vaultId) await deletePaymentToken(s.wallet.vaultId);
    s.wallet = {};
    log("paypal", "PayPal wallet disconnected. Saved payment token deleted.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, 500);
  }
}
