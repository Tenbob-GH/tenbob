import { NextResponse } from "next/server";
import { attachMetadata, getListings, startIndexer } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    void startIndexer();
    const { searchParams } = new URL(req.url);
    const sort = searchParams.get("sort") === "price" ? "price" : "recent";
    const listings = await getListings(sort);
    const withMeta = await Promise.all(listings.map((l) => attachMetadata(l)));
    return NextResponse.json({ listings: withMeta });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load listings";
    return NextResponse.json({ error: message, listings: [] }, { status: 500 });
  }
}
