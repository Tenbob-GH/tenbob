"use client";

import Link from "next/link";
import type { Listing } from "@/lib/types";
import { formatXrp } from "@/lib/xrpl";
import { truncateMiddle } from "@/lib/format";
import { NftImage } from "./NftImage";

export function NftCard({ listing }: { listing: Listing }) {
  const name = listing.metadata?.name ?? "Untitled NFT";
  const image = listing.metadata?.image;
  const price = listing.price_drops ? `${formatXrp(listing.price_drops)} XRP` : "—";

  return (
    <Link
      href={`/nft/${listing.nft_id}`}
      className="group overflow-hidden rounded-2xl border border-line bg-ink-800 transition hover:border-lime/50"
    >
      <NftImage src={image} alt={name} className="aspect-square w-full" />
      <div className="space-y-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-base leading-tight group-hover:text-lime">{name}</h3>
          <span className="shrink-0 font-mono text-sm text-lime">{price}</span>
        </div>
        <p className="font-mono text-[11px] text-mist">
          {truncateMiddle(listing.issuer, 8, 6)} · taxon {listing.taxon}
        </p>
      </div>
    </Link>
  );
}
