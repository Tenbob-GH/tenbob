import { NextResponse } from "next/server";
import { XummSdk } from "xumm-sdk";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ uuid: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const key = process.env.XUMM_API_KEY;
  const secret = process.env.XUMM_API_SECRET;
  if (!key || !secret) {
    return NextResponse.json({ error: "Xaman is not configured" }, { status: 503 });
  }
  const { uuid } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) {
    return NextResponse.json({ error: "Invalid payload id" }, { status: 400 });
  }
  try {
    const xumm = new XummSdk(key, secret);
    const payload = await xumm.payload.get(uuid, true);
    if (!payload) {
      return NextResponse.json({ error: "Payload not found" }, { status: 404 });
    }
    return NextResponse.json({
      signed: payload.meta.signed,
      cancelled: payload.meta.cancelled,
      expired: payload.meta.expired,
      account: payload.response.account,
      txid: payload.response.txid,
      dispatchedResult: payload.response.dispatched_result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Xaman lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
