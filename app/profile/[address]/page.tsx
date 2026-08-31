"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { NftImage } from "@/components/NftImage";
import { ErrorBlock, EmptyState, LoadingBlock, TxResult } from "@/components/TxResult";
import { useWallet } from "@/components/WalletProvider";
import { ingestHash } from "@/lib/client";
import { formatError, truncateMiddle } from "@/lib/format";
import { fetchMetadataJson } from "@/lib/metadata";
import {
  buildCancelOfferTx,
  decodedUriOf,
  getAccountNftOffers,
  getAccountNfts,
  type AccountNftOffer,
} from "@/lib/nft";
import type { NftMetadata, TxOutcome } from "@/lib/types";
import { formatXrp } from "@/lib/xrpl";

type Owned = Awaited<ReturnType<typeof getAccountNfts>>[number] & { metadata: NftMetadata | null };

export default function ProfilePage() {
  const params = useParams<{ address: string }>();
  const address = String(params.address ?? "");
  const { wallet, signAndSubmit, refreshBalance } = useWallet();
  const [nfts, setNfts] = useState<Owned[]>([]);
  const [offers, setOffers] = useState<AccountNftOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<TxOutcome | null>(null);
  const isSelf = wallet?.address === address;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [owned, active] = await Promise.all([getAccountNfts(address), getAccountNftOffers(address)]);
      const withMeta = await Promise.all(
        owned.map(async (nft) => {
          const uri = decodedUriOf(nft);
          const metadata = uri ? await fetchMetadataJson(uri).catch(() => null) : null;
          return { ...nft, metadata };
        }),
      );
      setNfts(withMeta);
      setOffers(active);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function cancel(offer: AccountNftOffer) {
    if (!wallet) return;
    try {
      const tx = buildCancelOfferTx({
        account: wallet.address,
        offerIndexes: [offer.index],
      });
      const result = await signAndSubmit(tx as unknown as Record<string, unknown>);
      setOutcome(result);
      if (result.hash) await ingestHash(result.hash);
      await refreshBalance();
      await load();
    } catch (err) {
      setError(formatError(err));
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-lime">Account</p>
        <h1 className="font-display text-3xl sm:text-4xl">
          <CopyButton value={address} label={truncateMiddle(address, 10, 8)} className="text-2xl sm:text-4xl" />
        </h1>
      </div>
      {error ? <ErrorBlock message={error} /> : null}
      <TxResult outcome={outcome} />
      {loading ? <LoadingBlock label="Loading account_nfts + nft offers…" /> : null}

      {!loading ? (
        <>
          <section>
            <h2 className="mb-3 font-display text-2xl">Owned NFTs</h2>
            {nfts.length === 0 ? (
              <EmptyState title="No NFTs on this account" body="account_nfts returned an empty set." />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {nfts.map((nft) => (
                  <Link
                    key={nft.NFTokenID}
                    href={`/nft/${nft.NFTokenID}`}
                    className="overflow-hidden rounded-2xl border border-line bg-ink-800 hover:border-lime/50"
                  >
                    <NftImage
                      src={nft.metadata?.image}
                      alt={nft.metadata?.name ?? nft.NFTokenID}
                      className="aspect-square w-full"
                    />
                    <div className="p-3">
                      <p className="font-display">{nft.metadata?.name ?? truncateMiddle(nft.NFTokenID, 10, 8)}</p>
                      <p className="font-mono text-[11px] text-mist">taxon {nft.NFTokenTaxon}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-display text-2xl">Active offers</h2>
            {offers.length === 0 ? (
              <EmptyState title="No NFTokenOffer objects" body="account_objects type nft_offer is empty." />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-mist">
                    <tr>
                      <th className="px-4 py-2">Side</th>
                      <th className="px-4 py-2">NFT</th>
                      <th className="px-4 py-2">Amount</th>
                      <th className="px-4 py-2">Index</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map((offer) => (
                      <tr key={offer.index} className="border-t border-line">
                        <td className="px-4 py-2">{offer.isSell ? "Sell" : "Buy"}</td>
                        <td className="px-4 py-2">
                          <Link href={`/nft/${offer.nftokenID}`} className="hover:text-lime">
                            {truncateMiddle(offer.nftokenID, 10, 8)}
                          </Link>
                        </td>
                        <td className="px-4 py-2 font-mono">
                          {offer.amountDrops ? `${formatXrp(offer.amountDrops)} XRP` : "IOU"}
                        </td>
                        <td className="px-4 py-2">
                          <CopyButton value={offer.index} label={truncateMiddle(offer.index, 10, 8)} />
                        </td>
                        <td className="px-4 py-2 text-right">
                          {isSelf ? (
                            <button
                              type="button"
                              onClick={() => void cancel(offer)}
                              className="text-xs text-[#ff8a70]"
                            >
                              Cancel
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
        </>
      ) : null}
    </div>
  );
}
