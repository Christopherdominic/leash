import { NextResponse } from "next/server";
import { appUrl, fail } from "@/lib/http";
import { createSetupToken } from "@/lib/paypal";
import { log, state } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Step 1 of clipping on the leash: ask PayPal for a vault setup token and send the user to approve it. */
export async function POST(req: Request) {
  try {
    const { id, approveUrl } = await createSetupToken(appUrl(req));
    state().wallet.pendingSetupTokenId = id;
    log("paypal", "Started PayPal wallet connection.");
    return NextResponse.json({ approveUrl });
  } catch (e) {
    return fail(e, 500);
  }
}
