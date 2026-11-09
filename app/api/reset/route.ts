import { NextResponse } from "next/server";
import { resetState } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Clears purchases, approvals, chat and rules for a fresh demo run. Keeps the connected wallet. */
export async function POST() {
  resetState(true);
  return NextResponse.json({ ok: true });
}
