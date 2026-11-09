import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { appUrl, fail } from "@/lib/http";
import { log } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { message } = (await req.json()) as { message?: string };
    if (!message?.trim()) return fail("Say what you want the agent to buy.");
    return NextResponse.json(await runAgent(message.trim().slice(0, 1000), appUrl(req)));
  } catch (e) {
    log("error", `Agent error: ${e instanceof Error ? e.message : String(e)}`);
    return fail(e, 500);
  }
}
