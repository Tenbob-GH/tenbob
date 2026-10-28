import { NextResponse } from "next/server";
import { XummSdk } from "xumm-sdk";
import { networkLabel, XRPL_WS } from "@/lib/xrpl";

export const dynamic = "force-dynamic";

function sdk() {
  const key = process.env.XUMM_API_KEY;
  const secret = process.env.XUMM_API_SECRET;
  if (!key || !secret) return null;
  return new XummSdk(key, secret);
}

export async function POST(req: Request) {
  const xumm = sdk();
  if (!xumm) {
    return NextResponse.json(
      { error: "Xaman is not configured. Set XUMM_API_KEY and XUMM_API_SECRET." },
      { status: 503 },
    );
  }
  try {
    const body = (await req.json()) as {
      txjson?: Record<string, unknown>;
      submit?: boolean;
    };
    if (!body.txjson || typeof body.txjson.TransactionType !== "string") {
      return NextResponse.json({ error: "txjson.TransactionType is required" }, { status: 400 });
    }
    const net = networkLabel();
    const created = await xumm.payload.create({
      txjson: body.txjson as { TransactionType: "SignIn" },
      options: {
        submit: body.submit !== false && body.txjson.TransactionType !== "SignIn",
        expire: 5,
        force_network: net === "Mainnet" ? "MAINNET" : net === "Testnet" ? "TESTNET" : undefined,
      },
    });
    if (!created) {
      return NextResponse.json({ error: "Xaman did not create a payload" }, { status: 502 });
    }
    return NextResponse.json({
      uuid: created.uuid,
      qrPng: created.refs.qr_png,
      deepLink: created.next.always,
      ws: created.refs.websocket_status,
      network: XRPL_WS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Xaman create failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
