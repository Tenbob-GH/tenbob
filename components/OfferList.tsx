"use client";

import type { NftOffer } from "@/lib/types";
import { formatXrp, rippleToUnixTime } from "@/lib/xrpl";
import { truncateMiddle } from "@/lib/format";
import { CopyButton } from "./CopyButton";

function expirationLabel(ripple?: number): string {
  if (!ripple) return "—";
  const ms = rippleToUnixTime(ripple) * 1000;
  return new Date(ms).toLocaleString();
}

export function OfferList({
  title,
  offers,
  empty,
  actionLabel,
  onAction,
  canAct,
}: {
  title: string;
  offers: NftOffer[];
  empty: string;
  actionLabel?: string;
  onAction?: (offer: NftOffer) => void;
  canAct?: (offer: NftOffer) => boolean;
}) {
  return (
    <section className="rounded-2xl border border-line bg-ink-800">
      <header className="border-b border-line px-4 py-3 font-display text-lg">{title}</header>
      {offers.length === 0 ? (
        <p className="px-4 py-8 text-sm text-mist">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-mist">
              <tr>
                <th className="px-4 py-2 font-medium">Price</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Destination</th>
                <th className="px-4 py-2 font-medium">Expires</th>
                <th className="px-4 py-2 font-medium">Offer index</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr key={offer.nft_offer_index} className="border-t border-line/70">
                  <td className="px-4 py-2 font-mono">
                    {offer.amount ? `${formatXrp(offer.amount)} XRP` : "IOU"}
                  </td>
                  <td className="px-4 py-2">
                    <CopyButton value={offer.owner} label={truncateMiddle(offer.owner)} />
                  </td>
                  <td className="px-4 py-2">
                    {offer.destination ? (
                      <CopyButton value={offer.destination} label={truncateMiddle(offer.destination)} />
                    ) : (
                      <span className="text-mist">public</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-mist">{expirationLabel(offer.expiration)}</td>
                  <td className="px-4 py-2">
                    <CopyButton value={offer.nft_offer_index} label={truncateMiddle(offer.nft_offer_index, 10, 8)} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {actionLabel && onAction && (canAct ? canAct(offer) : true) ? (
                      <button
                        type="button"
                        onClick={() => onAction(offer)}
                        className="rounded-full bg-lime px-3 py-1 text-xs font-semibold text-ink-950"
                      >
                        {actionLabel}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
