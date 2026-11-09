import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { transcribe } from "@/lib/transcribe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

/** Receives raw recorded audio from the mic button and returns the spoken text. */
export async function POST(req: Request) {
  try {
    const mediaType = (req.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!mediaType.startsWith("audio/")) return fail("Send audio.");
    const buf = new Uint8Array(await req.arrayBuffer());
    if (!buf.length) return fail("No audio recorded.");
    if (buf.length > MAX_BYTES) return fail("Recording too long. Keep it under a minute.");
    return NextResponse.json({ text: await transcribe(buf, mediaType) });
  } catch (e) {
    return fail(e, 500);
  }
}
