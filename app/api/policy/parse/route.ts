import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { parseRules } from "@/lib/rules-parser";
import { state, withState } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Drafts a policy from plain English. Does NOT save it; the UI shows it for review first. */
export const POST = withState(async function POST(req: Request) {
  try {
    const { text } = (await req.json()) as { text?: string };
    if (!text?.trim()) return fail("Describe your rules first.");
    return NextResponse.json(await parseRules(text.slice(0, 1000), state().policy));
  } catch (e) {
    return fail(e);
  }
});
