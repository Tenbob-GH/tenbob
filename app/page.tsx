"use client";

import { FormEvent, useEffect, useState } from "react";
import { NftCard } from "@/components/NftCard";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/TxResult";
import type { Listing } from "@/lib/types";
import { fetchMetadataJson } from "@/lib/metadata";
import { decodeUri } from "@/lib/xrpl";
import { truncateMiddle } from "@/lib/format";
import Link from "next/link";

type IssuerNft = {
  nft_id: string;
  issuer: string;
  nft_taxon: number;
  owner: string;
  uri: string;
  metadata?: Listing["metadata"];
};

export default function HomePage() {
  const [sort, setSort] = useState<"recent" | "price">("recent");
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issuer, setIssuer] = useState("");
  const [issuerNfts, setIssuerNfts] = useState<IssuerNft[] | null>(null);
  const [issuerError, setIssuerError] = useState<string | null>(null);
  const [issuerLoading, setIssuerLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/listings?sort=${sort}`)
      .then(async (res) => {
        const body = (await res.json()) as { listings?: Listing[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "Failed to load listings");
        const rows = body.listings ?? [];
        const hydrated = await Promise.all(
          rows.map(async (row) => {
            if (row.metadata) return row;
            const uri = decodeUri(row.uri);
            const metadata = uri ? await fetchMetadataJson(uri).catch(() => null) : null;
            return { ...row, metadata };
          }),
        );
        if (!cancelled) setListings(hydrated);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load listings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sort]);

  async function onIssuer(e: FormEvent) {
    e.preventDefault();
    if (!issuer.trim()) return;
    setIssuerLoading(true);
    setIssuerError(null);
    try {
      const res = await fetch(`/api/issuer?issuer=${encodeURIComponent(issuer.trim())}`);
      const body = (await res.json()) as { nfts?: IssuerNft[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "nfts_by_issuer failed");
      setIssuerNfts(body.nfts ?? []);
    } catch (err) {
      setIssuerNfts(null);
      setIssuerError(err instanceof Error ? err.message : "Issuer lookup failed");
    } finally {
      setIssuerLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-lime">XLS-20 native</p>
          <h1 className="font-display text-4xl sm:text-5xl">The ledger is the catalog.</h1>
          <p className="mt-2 max-w-xl text-sm text-mist">
            Tenbob lists XRP Ledger NFTs from the transaction stream — no Ethereum wrappers, no
            invented fields. Amounts are drops. URIs are hex.
          </p>
        </div>
        <div className="flex gap-2">
          {(["recent", "price"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={`rounded-full px-4 py-1.5 text-sm ${
                sort === key ? "bg-lime text-ink-950" : "border border-line text-mist"
              }`}
            >
              {key === "recent" ? "Recent" : "Price"}
            </button>
          ))}
        </div>
      </section>

      {loading ? <LoadingBlock label="Loading listings index…" /> : null}
      {error ? <ErrorBlock message={error} /> : null}
      {!loading && !error && listings.length === 0 ? (
        <EmptyState
          title="No live listings yet"
          body="Mint an NFT, then create a sell offer. The indexer subscribes to the ledger and this grid reads /api/listings — not a fake catalog."
        />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((listing) => (
          <NftCard key={listing.nft_id} listing={listing} />
        ))}
      </div>

      <section className="rounded-2xl border border-line bg-ink-800 p-5">
        <h2 className="font-display text-xl">Load by issuer</h2>
        <p className="mt-1 text-sm text-mist">
          Fallback explorer using Clio <span className="font-mono">nfts_by_issuer</span>. Set{" "}
          <span className="font-mono">NEXT_PUBLIC_XRPL_CLIO_WS</span> if the default rippled node
          rejects the command.
        </p>
        <form onSubmit={onIssuer} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            placeholder="rIssuerAddress…"
            className="flex-1 rounded-xl border border-line bg-ink-900 px-3 py-2 font-mono text-sm outline-none focus:border-lime"
          />
          <button
            type="submit"
            className="rounded-xl bg-lime px-4 py-2 text-sm font-semibold text-ink-950"
          >
            {issuerLoading ? "Querying…" : "Look up"}
          </button>
        </form>
        {issuerError ? <div className="mt-3"><ErrorBlock message={issuerError} /></div> : null}
        {issuerNfts ? (
          issuerNfts.length === 0 ? (
            <p className="mt-4 text-sm text-mist">No NFTs for that issuer.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {issuerNfts.map((nft) => (
                <li key={nft.nft_id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <Link href={`/nft/${nft.nft_id}`} className="hover:text-lime">
                      {nft.metadata?.name ?? truncateMiddle(nft.nft_id, 12, 8)}
                    </Link>
                    <p className="font-mono text-[11px] text-mist">taxon {nft.nft_taxon}</p>
                  </div>
                  <span className="font-mono text-xs text-mist">{truncateMiddle(nft.owner)}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}
