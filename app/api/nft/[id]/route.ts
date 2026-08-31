import { NextResponse } from "next/server";
import { attachMetadata, getListing, ingestTxHash, startIndexer } from "@/lib/indexer";
import { decodeUri } from "@/lib/xrpl";
import { getNftBuyOffers, getNftInfo, getNftSellOffers } from "@/lib/nft";
import { fetchMetadataJson } from "@/lib/metadata";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    void startIndexer();
    const { id } = await ctx.params;
    const nftId = id.toUpperCase();
    const listing = await getListing(nftId);
    const [sellOffers, buyOffers, info] = await Promise.all([
      getNftSellOffers(nftId),
      getNftBuyOffers(nftId),
      getNftInfo(nftId).catch(() => null),
    ]);
    const uri = listing?.uri || info?.uri || "";
    const decoded = decodeUri(uri);
    const metadata =
      listing?.metadata ??
      (decoded ? await fetchMetadataJson(decoded).catch(() => null) : null);
    const hydrated = listing ? await attachMetadata({ ...listing, metadata }) : null;
    return NextResponse.json({
      nft_id: nftId,
      listing: hydrated,
      info,
      uri: decoded,
      metadata,
      sell_offers: sellOffers,
      buy_offers: buyOffers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load NFT";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { hash?: string };
    if (body.hash) {
      await ingestTxHash(body.hash);
    }
    return NextResponse.json({ ok: true, nft_id: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingest failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
