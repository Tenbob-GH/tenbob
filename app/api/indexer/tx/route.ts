import { NextResponse } from "next/server";
import { ingestTxHash, startIndexer } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    void startIndexer();
    const body = (await req.json()) as { hash?: string };
    if (!body.hash || !/^[A-F0-9]{64}$/i.test(body.hash)) {
      return NextResponse.json({ error: "hash (64 hex) is required" }, { status: 400 });
    }
    await ingestTxHash(body.hash);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingest failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
