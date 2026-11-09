import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { refundPurchase } from "@/lib/purchase";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return NextResponse.json({ purchase: await refundPurchase(id) });
  } catch (e) {
    return fail(e);
  }
}
