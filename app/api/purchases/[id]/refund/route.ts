import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { refundPurchase } from "@/lib/purchase";
import { withState } from "@/lib/store";

export const dynamic = "force-dynamic";

export const POST = withState(async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return NextResponse.json({ purchase: await refundPurchase(id) });
  } catch (e) {
    return fail(e);
  }
});
