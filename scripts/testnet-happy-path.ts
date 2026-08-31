import { Wallet, type SubmittableTransaction } from "xrpl";
import { buildAcceptSellOfferTx, buildMintTx, buildSellOfferTx, extractNFTokenID, extractOfferIndex, getAccountNfts, submitAutofilled } from "../lib/nft";
import { getClient } from "../lib/xrpl";

const FAUCET = "https://faucet.altnet.rippletest.net/accounts";
const APP = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

type FaucetAccount = { address: string; secret: string };

async function fund(): Promise<FaucetAccount> {
  let last = "faucet failed";
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(FAUCET, { method: "POST", headers: { "Content-Type": "application/json" } });
    if (res.ok) {
      const body = (await res.json()) as { account?: { address?: string; secret?: string } };
      if (body.account?.address && body.account.secret) {
        return { address: body.account.address, secret: body.account.secret };
      }
    }
    last = `faucet HTTP ${res.status}`;
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(last);
}

async function waitForApp() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${APP}/api/listings`);
      if (res.ok || res.status === 500) return;
    } catch {
      /* still booting */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`App not reachable at ${APP}`);
}

async function ingest(hash: string) {
  await fetch(`${APP}/api/indexer/tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hash }),
  });
}

async function main() {
  console.log("Waiting for Next.js at", APP);
  await waitForApp();

  console.log("Funding seller + buyer from Testnet faucet…");
  const sellerFunded = await fund();
  const buyerFunded = await fund();
  const seller = Wallet.fromSeed(sellerFunded.secret);
  const buyer = Wallet.fromSeed(buyerFunded.secret);
  if (seller.classicAddress !== sellerFunded.address) {
    throw new Error("Seller faucet/wallet mismatch");
  }

  const metaRes = await fetch(`${APP}/api/metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Tenbob Testnet Drop",
      description: "Happy-path mint from scripts/testnet-happy-path.ts",
      image: "https://xrpl.org/static/img/favicon-new.png",
      attributes: [{ trait_type: "network", value: "testnet" }],
    }),
  });
  const meta = (await metaRes.json()) as { uri?: string; error?: string };
  if (!metaRes.ok || !meta.uri) throw new Error(meta.error ?? "metadata store failed");
  console.log("Metadata URI", meta.uri);

  const client = await getClient();
  await client.request({ command: "account_info", account: seller.classicAddress });

  const mintTx = buildMintTx({
    account: seller.classicAddress,
    metadataUrl: meta.uri,
    taxon: 42,
    transferFee: 1000,
    flags: 9,
  });
  const minted = await submitAutofilled(mintTx as SubmittableTransaction, (p) => seller.sign(p));
  console.log("Mint", minted.engineResult, minted.hash);
  if (!minted.ok || !minted.hash) throw new Error(`Mint failed: ${minted.engineResult}`);
  await ingest(minted.hash);
  const nftId = extractNFTokenID(minted.result);
  if (!nftId) throw new Error("Could not parse NFTokenID from mint metadata");
  console.log("NFTokenID", nftId);

  const listTx = buildSellOfferTx({
    account: seller.classicAddress,
    nftokenID: nftId,
    amountDrops: "1500000",
  });
  const listed = await submitAutofilled(listTx as SubmittableTransaction, (p) => seller.sign(p));
  console.log("List", listed.engineResult, listed.hash);
  if (!listed.ok) throw new Error(`List failed: ${listed.engineResult}`);
  await ingest(listed.hash!);
  const sellOffer = extractOfferIndex(listed.result);
  if (!sellOffer) throw new Error("Could not parse sell offer index");
  console.log("Sell offer", sellOffer);

  const acceptTx = buildAcceptSellOfferTx({
    account: buyer.classicAddress,
    sellOfferIndex: sellOffer,
  });
  const bought = await submitAutofilled(acceptTx as SubmittableTransaction, (p) => buyer.sign(p));
  console.log("Accept", bought.engineResult, bought.hash);
  if (!bought.ok) throw new Error(`Accept failed: ${bought.engineResult}`);
  await ingest(bought.hash!);

  const owned = await getAccountNfts(buyer.classicAddress);
  const holds = owned.some((n) => n.NFTokenID === nftId);
  if (!holds) throw new Error("Buyer account_nfts does not include the minted NFT");

  const listingsRes = await fetch(`${APP}/api/listings?sort=recent`);
  const listings = (await listingsRes.json()) as { listings?: { nft_id: string; status: string }[] };
  const stillListed = (listings.listings ?? []).some((l) => l.nft_id === nftId);
  if (stillListed) {
    console.warn("Indexer still shows the NFT as listed; stream may lag. Detail endpoint:");
  }
  const detail = await fetch(`${APP}/api/nft/${nftId}`);
  const detailBody = (await detail.json()) as { listing?: { status?: string }; sell_offers?: unknown[] };
  console.log("Detail status", detailBody.listing?.status, "sell offers", detailBody.sell_offers?.length ?? 0);
  console.log("HAPPY_PATH_OK", nftId);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
