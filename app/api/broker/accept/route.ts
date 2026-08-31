import { NextResponse } from "next/server";
import { Wallet, type SubmittableTransaction } from "xrpl";
import { brokerAddress, brokerFeeDrops } from "@/lib/broker";
import { ingestTxHash, startIndexer } from "@/lib/indexer";
import { buildBrokerAcceptTx, getNftBuyOffers, getNftSellOffers, submitAutofilled } from "@/lib/nft";

export const dynamic = "force-dynamic";

export async function GET() {
  const address = brokerAddress();
  const seed = process.env.BROKER_SEED;
  return NextResponse.json({
    enabled: Boolean(address && seed),
    address: address || null,
    feeBps: Number(process.env.NEXT_PUBLIC_BROKER_FEE_BPS ?? 150),
  });
}

export async function POST(req: Request) {
  try {
    void startIndexer();
    const seed = process.env.BROKER_SEED;
    const address = brokerAddress();
    if (!seed || !address) {
      return NextResponse.json(
        { error: "Broker is not configured. Falling back to direct accept is a client-side path." },
        { status: 503 },
      );
    }
    const broker = Wallet.fromSeed(seed);
    if (broker.classicAddress !== address) {
      return NextResponse.json(
        { error: "BROKER_SEED does not match NEXT_PUBLIC_BROKER_ADDRESS" },
        { status: 500 },
      );
    }
    const body = (await req.json()) as {
      sellOfferIndex?: string;
      buyOfferIndex?: string;
      nftId?: string;
    };
    if (!body.sellOfferIndex || !body.buyOfferIndex) {
      return NextResponse.json({ error: "sellOfferIndex and buyOfferIndex are required" }, { status: 400 });
    }

    if (body.nftId) {
      const [sells, buys] = await Promise.all([
        getNftSellOffers(body.nftId),
        getNftBuyOffers(body.nftId),
      ]);
      const sell = sells.find((o) => o.nft_offer_index === body.sellOfferIndex);
      const buy = buys.find((o) => o.nft_offer_index === body.buyOfferIndex);
      if (!sell || !buy) {
        return NextResponse.json({ error: "Offers not found on ledger" }, { status: 404 });
      }
      if (sell.destination && sell.destination !== broker.classicAddress) {
        return NextResponse.json({ error: "Sell offer Destination is not this broker" }, { status: 403 });
      }
    }

    const sellOffers = body.nftId ? await getNftSellOffers(body.nftId) : [];
    const sell = sellOffers.find((o) => o.nft_offer_index === body.sellOfferIndex);
    const price = sell?.amount ?? "0";
    const fee = price !== "0" ? brokerFeeDrops(price) : "0";

    const tx = buildBrokerAcceptTx({
      brokerAccount: broker.classicAddress,
      sellOfferIndex: body.sellOfferIndex,
      buyOfferIndex: body.buyOfferIndex,
      brokerFeeDrops: fee,
    });

    const outcome = await submitAutofilled(tx as SubmittableTransaction, (prepared) =>
      broker.sign(prepared),
    );
    if (outcome.hash) {
      await ingestTxHash(outcome.hash).catch(() => undefined);
    }
    return NextResponse.json({
      ok: outcome.ok,
      hash: outcome.hash,
      engineResult: outcome.engineResult,
      engineResultMessage: outcome.engineResultMessage,
      kind: outcome.kind,
      brokerFeeDrops: fee,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Broker accept failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
