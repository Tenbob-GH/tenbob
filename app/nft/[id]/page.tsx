"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { NftImage } from "@/components/NftImage";
import { OfferList } from "@/components/OfferList";
import { ErrorBlock, LoadingBlock, TxResult } from "@/components/TxResult";
import { useWallet } from "@/components/WalletProvider";
import { brokerAddress, brokerConfigured, buyAmountWithBrokerFee, feePercentLabel } from "@/lib/broker";
import { ingestHash } from "@/lib/client";
import { formatError, truncateMiddle } from "@/lib/format";
import {
  buildAcceptSellOfferTx,
  buildBuyOfferTx,
  buildCancelOfferTx,
  buildSellOfferTx,
  extractOfferIndex,
  listingDestination,
} from "@/lib/nft";
import type { Listing, NftMetadata, NftOffer, TxOutcome } from "@/lib/types";
import { getClient, toDrops, unixToRippleTime } from "@/lib/xrpl";

type Detail = {
  nft_id: string;
  listing: Listing | null;
  info: { owner?: string; issuer?: string; nft_taxon?: number; uri?: string } | null;
  uri: string;
  metadata: NftMetadata | null;
  sell_offers: NftOffer[];
  buy_offers: NftOffer[];
  error?: string;
};

export default function NftDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "").toUpperCase();
  const { wallet, signAndSubmit, refreshBalance } = useWallet();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<TxOutcome | null>(null);
  const [listPrice, setListPrice] = useState("1");
  const [listExp, setListExp] = useState("");
  const [bidPrice, setBidPrice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/nft/${id}`);
      const body = (await res.json()) as Detail;
      if (!res.ok) throw new Error(body.error ?? "Failed to load NFT");
      setDetail(body);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const owner =
    detail?.info?.owner ||
    detail?.listing?.owner ||
    "";
  const issuer = detail?.listing?.issuer || detail?.info?.issuer || "";
  const taxon = detail?.listing?.taxon ?? detail?.info?.nft_taxon ?? 0;
  const isOwner = Boolean(wallet && owner && wallet.address === owner);
  const metadata = detail?.metadata ?? detail?.listing?.metadata ?? null;

  async function afterTx(result: TxOutcome) {
    setOutcome(result);
    if (result.hash) await ingestHash(result.hash);
    await refreshBalance();
    await load();
  }

  async function listForSale() {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
      const amountDrops = toDrops(listPrice);
      const expiration = listExp
        ? unixToRippleTime(Math.floor(new Date(listExp).getTime() / 1000))
        : undefined;
      const tx = buildSellOfferTx({
        account: wallet.address,
        nftokenID: id,
        amountDrops,
        destination: listingDestination(),
        expiration,
      });
      const result = await signAndSubmit(tx as unknown as Record<string, unknown>);
      await afterTx(result);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function buySellOffer(offer: NftOffer) {
    if (!wallet) {
      setError("Connect a wallet to buy. Keys never leave the wallet.");
      return;
    }
    if (!offer.amount) {
      setError("Only XRP (drops) offers are supported.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dest = offer.destination;
      const broker = brokerAddress();
      const mustBroker = brokerConfigured() && dest === broker;
      if (mustBroker) {
        const buyTx = buildBuyOfferTx({
          account: wallet.address,
          owner: offer.owner,
          nftokenID: id,
          amountDrops: buyAmountWithBrokerFee(offer.amount),
          destination: broker,
        });
        const buyResult = await signAndSubmit(buyTx as unknown as Record<string, unknown>);
        if (!buyResult.ok) {
          await afterTx(buyResult);
          return;
        }
        if (buyResult.hash) await ingestHash(buyResult.hash);
        const client = await getClient();
        const txRes = await client.request({ command: "tx", transaction: buyResult.hash! });
        let buyIndex = extractOfferIndex(txRes as never);
        if (!buyIndex) {
          const refreshed = (await (await fetch(`/api/nft/${id}`)).json()) as Detail;
          buyIndex = refreshed.buy_offers.find((o) => o.owner === wallet.address)?.nft_offer_index;
        }
        if (!buyIndex) throw new Error("Buy offer submitted but index was not found");
        const brokerRes = await fetch("/api/broker/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sellOfferIndex: offer.nft_offer_index,
            buyOfferIndex: buyIndex,
            nftId: id,
          }),
        });
        const brokerBody = (await brokerRes.json()) as TxOutcome & { error?: string };
        if (!brokerRes.ok) throw new Error(brokerBody.error ?? "Broker accept failed");
        await afterTx(brokerBody);
        return;
      }
      if (dest && dest !== wallet.address) {
        throw new Error("This sell offer is restricted to another Destination.");
      }
      const tx = buildAcceptSellOfferTx({
        account: wallet.address,
        sellOfferIndex: offer.nft_offer_index,
      });
      const result = await signAndSubmit(tx as unknown as Record<string, unknown>);
      await afterTx(result);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function placeBuyOffer() {
    if (!wallet || !owner) return;
    setBusy(true);
    setError(null);
    try {
      const amountDrops = toDrops(bidPrice);
      const tx = buildBuyOfferTx({
        account: wallet.address,
        owner,
        nftokenID: id,
        amountDrops,
        destination: listingDestination(),
      });
      const result = await signAndSubmit(tx as unknown as Record<string, unknown>);
      await afterTx(result);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelOffer(offer: NftOffer) {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
      const tx = buildCancelOfferTx({
        account: wallet.address,
        offerIndexes: [offer.nft_offer_index],
      });
      const result = await signAndSubmit(tx as unknown as Record<string, unknown>);
      await afterTx(result);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingBlock label="Loading NFT from ledger + index…" />;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div>
        <NftImage
          src={metadata?.image}
          alt={metadata?.name ?? "NFT"}
          className="aspect-square w-full rounded-2xl"
        />
      </div>
      <div className="space-y-4">
        <p className="text-xs uppercase tracking-[0.2em] text-lime">NFToken</p>
        <h1 className="font-display text-4xl">{metadata?.name ?? "Untitled NFT"}</h1>
        <p className="text-sm text-mist">{metadata?.description || "No description in metadata."}</p>
        <div className="space-y-1 rounded-2xl border border-line bg-ink-800 p-4 text-sm">
          <Row label="NFT ID" value={<CopyButton value={id} label={truncateMiddle(id, 12, 10)} />} />
          <Row label="Owner" value={owner ? <CopyButton value={owner} label={truncateMiddle(owner)} /> : "—"} />
          <Row label="Issuer" value={issuer ? <CopyButton value={issuer} label={truncateMiddle(issuer)} /> : "—"} />
          <Row label="Taxon" value={String(taxon)} />
          <Row
            label="URI"
            value={
              detail?.uri ? (
                <CopyButton value={detail.uri} label={truncateMiddle(detail.uri, 18, 10)} />
              ) : (
                "—"
              )
            }
          />
        </div>
        {metadata?.attributes?.length ? (
          <ul className="flex flex-wrap gap-2">
            {metadata.attributes.map((a) => (
              <li key={`${a.trait_type}:${a.value}`} className="rounded-full border border-line px-3 py-1 text-xs">
                <span className="text-mist">{a.trait_type}:</span> {a.value}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? <ErrorBlock message={error} /> : null}
        <TxResult outcome={outcome} />
        {busy ? <p className="text-sm text-mist">Submitting… confirm in your wallet.</p> : null}

        {isOwner ? (
          <div className="rounded-2xl border border-line bg-ink-800 p-4">
            <h2 className="font-display text-lg">List for sale</h2>
            <p className="mt-1 text-xs text-mist">
              Sell offer flag tfSellToken = 1. Amount in drops.
              {brokerConfigured()
                ? ` Destination = broker (${truncateMiddle(brokerAddress())}), fee ${feePercentLabel()}.`
                : " No broker configured — public offer, 0% platform fee."}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
                className="flex-1 rounded-xl border border-line bg-ink-900 px-3 py-2 text-sm"
                placeholder="Price in XRP"
              />
              <input
                type="datetime-local"
                value={listExp}
                onChange={(e) => setListExp(e.target.value)}
                className="rounded-xl border border-line bg-ink-900 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy || !wallet}
                onClick={() => void listForSale()}
                className="rounded-xl bg-lime px-4 py-2 text-sm font-semibold text-ink-950"
              >
                Create sell offer
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-ink-800 p-4">
            <h2 className="font-display text-lg">Make offer</h2>
            <div className="mt-3 flex gap-2">
              <input
                value={bidPrice}
                onChange={(e) => setBidPrice(e.target.value)}
                className="flex-1 rounded-xl border border-line bg-ink-900 px-3 py-2 text-sm"
                placeholder="Bid in XRP"
              />
              <button
                type="button"
                disabled={busy || !wallet || !bidPrice}
                onClick={() => void placeBuyOffer()}
                className="rounded-xl border border-lime px-4 py-2 text-sm font-semibold text-lime"
              >
                Make offer
              </button>
            </div>
            {brokerConfigured() ? (
              <p className="mt-2 text-xs text-mist">
                Brokered buys add {feePercentLabel()} on top of the sell price so the seller still
                receives the listed amount.
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="space-y-4 lg:col-span-2">
        <OfferList
          title="Sell offers"
          offers={detail?.sell_offers ?? []}
          empty="No sell offers on ledger."
          actionLabel={isOwner ? "Cancel" : "Buy"}
          canAct={(offer) => {
            if (isOwner) return Boolean(wallet && offer.owner === wallet.address);
            return true;
          }}
          onAction={(offer) => {
            if (isOwner) void cancelOffer(offer);
            else void buySellOffer(offer);
          }}
        />
        <OfferList
          title="Buy offers"
          offers={detail?.buy_offers ?? []}
          empty="No buy offers on ledger."
          actionLabel="Cancel"
          canAct={(offer) => Boolean(wallet && offer.owner === wallet.address)}
          onAction={(offer) => void cancelOffer(offer)}
        />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-mist">{label}</span>
      <span>{value}</span>
    </div>
  );
}
