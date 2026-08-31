import { getNftsByIssuer } from "@/lib/nft";
import { decodeUri } from "@/lib/xrpl";
import { fetchMetadataJson } from "@/lib/metadata";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const issuer = new URL(req.url).searchParams.get("issuer");
  const taxonParam = new URL(req.url).searchParams.get("taxon");
  if (!issuer) {
    return NextResponse.json({ error: "issuer is required" }, { status: 400 });
  }
  try {
    const taxon = taxonParam !== null && taxonParam !== "" ? Number(taxonParam) : undefined;
    const result = await getNftsByIssuer(issuer, Number.isFinite(taxon) ? taxon : undefined);
    const nfts = await Promise.all(
      (result.nfts ?? []).map(async (nft) => {
        const uri = decodeUri(nft.uri ?? "");
        const metadata = uri ? await fetchMetadataJson(uri).catch(() => null) : null;
        return { ...nft, uri, metadata };
      }),
    );
    return NextResponse.json({ issuer: result.issuer, nfts, marker: result.marker });
  } catch (err) {
    const message = err instanceof Error ? err.message : "nfts_by_issuer failed (needs a Clio server)";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
