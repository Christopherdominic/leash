import { NextResponse } from "next/server";
import { getModel } from "@/lib/ai";
import { catalogSource } from "@/lib/catalog";
import { paypalMode } from "@/lib/paypal";
import { spendSnapshot } from "@/lib/policy";
import { publicState, state } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ...publicState(),
    spend: spendSnapshot(state().purchases),
    integrations: {
      paypal: paypalMode(),
      catalog: catalogSource(),
      ai: getModel()?.label ?? null,
      phonePush: Boolean(process.env.NTFY_TOPIC),
    },
  });
}
