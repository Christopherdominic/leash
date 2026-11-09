import { NextResponse } from "next/server";
import { appUrl } from "@/lib/http";
import { createPaymentToken } from "@/lib/paypal";
import { log, state } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Step 2: PayPal sends the user back here; exchange the approved setup token for a payment token (vault_id). */
export async function GET(req: Request) {
  const base = appUrl(req);
  const s = state();
  const url = new URL(req.url);
  const setupTokenId = url.searchParams.get("approval_token_id") ?? s.wallet.pendingSetupTokenId;
  if (!setupTokenId) return NextResponse.redirect(`${base}/?paypal=missing-token`);
  try {
    const t = await createPaymentToken(setupTokenId);
    s.wallet = { vaultId: t.vaultId, customerId: t.customerId, email: t.email };
    log("paypal", `PayPal wallet connected${t.email ? ` (${t.email})` : ""}. The agent can now pay within your rules.`);
    return NextResponse.redirect(`${base}/?paypal=connected`);
  } catch (e) {
    log("error", `PayPal connection failed: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.redirect(`${base}/?paypal=error`);
  }
}
