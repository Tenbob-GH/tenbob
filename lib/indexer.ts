import "server-only";

import { promises as fs } from "fs";
import path from "path";
import type { TransactionMetadata, TransactionStream, TxResponse } from "xrpl";
import { fetchMetadataJson } from "./metadata";
import { extractNFTokenID, extractOfferIndex, TF_SELL_TOKEN } from "./nft";
import type { Listing, ListingStatus } from "./types";
import { decodeUri, getClient } from "./xrpl";

const DATA_DIR = process.env.INDEXER_DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "listings.json");

type Store = { listings: Record<string, Listing> };

let memory: Store = { listings: {} };
let loaded = false;
let writeQueue: Promise<void> = Promise.resolve();
let started = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    memory = JSON.parse(raw) as Store;
    if (!memory.listings) memory.listings = {};
  } catch {
    memory = { listings: {} };
  }
}

async function persist() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(memory, null, 2), "utf8");
  } catch {
    /* read-only fs: keep memory */
  }
}

function mutate(fn: (store: Store) => void): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await ensureLoaded();
    fn(memory);
    await persist();
  });
  return writeQueue;
}

function nowIso() {
  return new Date().toISOString();
}

function upsert(partial: Partial<Listing> & { nft_id: string }) {
  const prev = memory.listings[partial.nft_id];
  const next: Listing = {
    nft_id: partial.nft_id,
    issuer: partial.issuer ?? prev?.issuer ?? "",
    taxon: partial.taxon ?? prev?.taxon ?? 0,
    owner: partial.owner ?? prev?.owner ?? "",
    uri: partial.uri ?? prev?.uri ?? "",
    sell_offer_index: partial.sell_offer_index === undefined ? prev?.sell_offer_index ?? null : partial.sell_offer_index,
    price_drops: partial.price_drops === undefined ? prev?.price_drops ?? null : partial.price_drops,
    destination: partial.destination === undefined ? prev?.destination ?? null : partial.destination,
    status: partial.status ?? prev?.status ?? "minted",
    updated_at: nowIso(),
    metadata: partial.metadata ?? prev?.metadata,
  };
  memory.listings[partial.nft_id] = next;
}

export async function getListings(sort: "price" | "recent" = "recent"): Promise<Listing[]> {
  await ensureLoaded();
  const listed = Object.values(memory.listings).filter((l) => l.status === "listed" && l.sell_offer_index);
  listed.sort((a, b) => {
    if (sort === "price") {
      return Number(BigInt(a.price_drops ?? "0") - BigInt(b.price_drops ?? "0"));
    }
    return b.updated_at.localeCompare(a.updated_at);
  });
  return listed;
}

export async function getListing(nftId: string): Promise<Listing | null> {
  await ensureLoaded();
  return memory.listings[nftId] ?? null;
}

export async function attachMetadata(listing: Listing): Promise<Listing> {
  if (listing.metadata) return listing;
  const uri = decodeUri(listing.uri);
  if (!uri) return listing;
  const metadata = await fetchMetadataJson(uri).catch(() => null);
  if (!metadata) return listing;
  await mutate((store) => {
    const row = store.listings[listing.nft_id];
    if (row) row.metadata = metadata;
  });
  return { ...listing, metadata };
}

type TxLike = {
  TransactionType?: string;
  Account?: string;
  Destination?: string;
  NFTokenID?: string;
  NFTokenTaxon?: number;
  URI?: string;
  Amount?: string | Record<string, unknown>;
  Flags?: number | Record<string, unknown>;
  Owner?: string;
  NFTokenOffers?: string[];
  NFTokenSellOffer?: string;
  NFTokenBuyOffer?: string;
};

function flagsToNumber(flags: TxLike["Flags"]): number {
  if (typeof flags === "number") return flags;
  if (flags && typeof flags === "object" && "tfSellNFToken" in flags && flags.tfSellNFToken) {
    return TF_SELL_TOKEN;
  }
  return 0;
}

function amountDrops(amount: TxLike["Amount"]): string | null {
  return typeof amount === "string" ? amount : null;
}

export async function ingestValidatedTx(tx: TxLike, meta: TransactionMetadata | string | undefined, hash?: string) {
  if (!tx.TransactionType) return;
  const typedMeta = typeof meta === "object" ? meta : undefined;
  const fake = {
    result: { hash: hash ?? "", meta: typedMeta },
  } as TxResponse;

  switch (tx.TransactionType) {
    case "NFTokenMint": {
      const nftId = extractNFTokenID(fake);
      if (!nftId) return;
      await mutate(() =>
        upsert({
          nft_id: nftId,
          issuer: tx.Account ?? "",
          taxon: tx.NFTokenTaxon ?? 0,
          owner: tx.Destination || tx.Account || "",
          uri: tx.URI ?? "",
          status: "minted",
          sell_offer_index: null,
          price_drops: null,
          destination: null,
        }),
      );
      break;
    }
    case "NFTokenCreateOffer": {
      const nftId = tx.NFTokenID;
      if (!nftId) return;
      const isSell = (flagsToNumber(tx.Flags) & TF_SELL_TOKEN) === TF_SELL_TOKEN;
      if (!isSell) {
        await mutate(() =>
          upsert({
            nft_id: nftId,
            owner: tx.Owner || undefined,
            status: memory.listings[nftId]?.status ?? "minted",
          }),
        );
        return;
      }
      const offerIndex = extractOfferIndex(fake);
      await mutate(() =>
        upsert({
          nft_id: nftId,
          owner: tx.Account ?? "",
          sell_offer_index: offerIndex ?? null,
          price_drops: amountDrops(tx.Amount),
          destination: tx.Destination ?? null,
          status: "listed",
        }),
      );
      break;
    }
    case "NFTokenAcceptOffer": {
      const nftId =
        extractNFTokenID(fake) ||
        findNftIdFromDeletedOffers(typedMeta) ||
        findListingByOffer(tx.NFTokenSellOffer || tx.NFTokenBuyOffer || "")?.nft_id;
      if (!nftId) return;
      const buyer = inferNewOwner(tx, typedMeta);
      await mutate(() =>
        upsert({
          nft_id: nftId,
          owner: buyer ?? memory.listings[nftId]?.owner ?? "",
          sell_offer_index: null,
          price_drops: null,
          destination: null,
          status: "sold",
        }),
      );
      break;
    }
    case "NFTokenCancelOffer": {
      const indexes = tx.NFTokenOffers ?? [];
      await mutate((store) => {
        for (const listing of Object.values(store.listings)) {
          if (listing.sell_offer_index && indexes.includes(listing.sell_offer_index)) {
            listing.sell_offer_index = null;
            listing.price_drops = null;
            listing.destination = null;
            listing.status = "canceled";
            listing.updated_at = nowIso();
          }
        }
      });
      break;
    }
    case "NFTokenBurn": {
      const nftId = tx.NFTokenID;
      if (!nftId) return;
      await mutate(() =>
        upsert({
          nft_id: nftId,
          status: "burned" satisfies ListingStatus,
          sell_offer_index: null,
          price_drops: null,
        }),
      );
      break;
    }
    default:
      break;
  }
}

function findListingByOffer(offerIndex: string): Listing | undefined {
  if (!offerIndex) return undefined;
  return Object.values(memory.listings).find((l) => l.sell_offer_index === offerIndex);
}

function findNftIdFromDeletedOffers(meta?: TransactionMetadata): string | undefined {
  if (!meta) return undefined;
  for (const node of meta.AffectedNodes ?? []) {
    if ("DeletedNode" in node && node.DeletedNode.LedgerEntryType === "NFTokenOffer") {
      const fields = node.DeletedNode.FinalFields as { NFTokenID?: string };
      if (fields.NFTokenID) return fields.NFTokenID;
    }
  }
  return undefined;
}

function inferNewOwner(tx: TxLike, meta?: TransactionMetadata): string | undefined {
  if (meta) {
    for (const node of meta.AffectedNodes ?? []) {
      if ("ModifiedNode" in node && node.ModifiedNode.LedgerEntryType === "NFTokenPage") {
        const account = node.ModifiedNode.FinalFields?.Account;
        // NFTokenPage index prefix is the owner; Account is not always present.
        if (typeof account === "string") return account;
      }
    }
  }
  return tx.Account;
}

export async function ingestTxHash(hash: string) {
  const client = await getClient();
  const res = await client.request({ command: "tx", transaction: hash });
  const txJson = (res.result as { tx_json?: TxLike }).tx_json ?? (res.result as unknown as TxLike);
  const meta = res.result.meta;
  await ingestValidatedTx(txJson, typeof meta === "object" ? meta : undefined, res.result.hash);
}

function txFromStream(event: TransactionStream): { tx: TxLike; meta?: TransactionMetadata } | null {
  if (event.validated === false) return null;
  const tx = (event.tx_json ?? event.transaction) as TxLike | undefined;
  if (!tx) return null;
  return { tx, meta: typeof event.meta === "object" ? event.meta : undefined };
}

export async function startIndexer(): Promise<void> {
  if (started) return;
  started = true;
  await ensureLoaded();
  const loop = async () => {
    try {
      const client = await getClient();
      await client.request({ command: "subscribe", streams: ["transactions"] });
      client.on("transaction", (event) => {
        const parsed = txFromStream(event);
        if (!parsed) return;
        void ingestValidatedTx(parsed.tx, parsed.meta, event.hash);
      });
    } catch {
      started = false;
      setTimeout(() => {
        void startIndexer();
      }, 5000);
    }
  };
  await loop();
}
