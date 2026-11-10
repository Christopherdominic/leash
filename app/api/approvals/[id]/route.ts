import { NextResponse } from "next/server";
import { appUrl, fail } from "@/lib/http";
import { resolveApproval } from "@/lib/purchase";
import { withState } from "@/lib/store";

export const dynamic = "force-dynamic";

export const POST = withState(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { approve } = (await req.json()) as { approve?: boolean };
    return NextResponse.json(await resolveApproval(id, approve === true, appUrl(req)));
  } catch (e) {
    return fail(e);
  }
});
