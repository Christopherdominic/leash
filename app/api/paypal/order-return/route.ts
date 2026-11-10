import { NextResponse } from "next/server";
import { appUrl } from "@/lib/http";
import { captureOrder } from "@/lib/paypal";
import { log, state, withState } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Fallback flow: user approved a single order in PayPal; capture it. */
export const GET = withState(async function GET(req: Request) {
  const base = appUrl(req);
  const url = new URL(req.url);
  const orderId = url.searchParams.get("token");
  const purchase = state().purchases.find((p) => p.id === url.searchParams.get("purchase"));
  if (!orderId || !purchase) return NextResponse.redirect(`${base}/?paypal=missing-order`);
  try {
    const r = await captureOrder(orderId);
    purchase.status = r.status === "COMPLETED" ? "COMPLETED" : "FAILED";
    purchase.paypalCaptureId = r.captureId;
    purchase.payerActionUrl = undefined;
    log(purchase.status === "COMPLETED" ? "allowed" : "error", `PayPal order ${orderId} for "${purchase.title}": ${r.status}.`);
    return NextResponse.redirect(`${base}/?paypal=paid`);
  } catch (e) {
    purchase.status = "FAILED";
    purchase.error = e instanceof Error ? e.message : String(e);
    log("error", `Capture failed for "${purchase.title}": ${purchase.error}`);
    return NextResponse.redirect(`${base}/?paypal=error`);
  }
});
