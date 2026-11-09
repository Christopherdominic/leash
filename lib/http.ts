import { NextResponse } from "next/server";

/** Public base URL, used for PayPal return links. Set APP_URL in production. */
export function appUrl(req: Request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function fail(e: unknown, status = 400) {
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
}
