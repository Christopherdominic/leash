import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { sanitizePolicy } from "@/lib/policy";
import { log, state } from "@/lib/store";
import type { Policy } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  try {
    const s = state();
    const before = s.policy;
    s.policy = sanitizePolicy((await req.json()) as Partial<Policy>, before);
    if (before.paused !== s.policy.paused) {
      log("policy", s.policy.paused ? "Kill switch ON: agent spending paused." : "Kill switch OFF: agent can spend within rules.");
    } else {
      log("policy", "Spending rules updated.");
    }
    return NextResponse.json({ policy: s.policy });
  } catch (e) {
    return fail(e);
  }
}
