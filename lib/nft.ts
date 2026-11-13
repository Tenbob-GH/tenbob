import {
  NFTokenCreateOfferFlags,
  type AccountNFToken,
  type NFTokenAcceptOffer,
  type NFTokenCancelOffer,
  type NFTokenCreateOffer,
  type NFTokenMint,
  type SubmittableTransaction,
  type TransactionMetadata,
  type TxResponse,
} from "xrpl";
import { brokerAddress, brokerConfigured } from "./broker";
import { outcomeFromTx, type TxOutcome } from "./engine";
import type { NftOffer } from "./types";
import {
  decodeUri,
  encodeUri,
  getClient,
  getClioClient,
  getXrpBalanceDrops,
} from "./xrpl";

/** tfBurnable (1) + tfTransferable (8). TransferFee is only valid with transferable. */
export const DEFAULT_MINT_FLAGS = 9;

/** Protocol flag tfSellToken / xrpl.js NFTokenCreateOfferFlags.tfSellNFToken. */
export const TF_SELL_TOKEN = NFTokenCreateOfferFlags.tfSellNFToken;

const MAX_TRANSFER_FEE = 50_000;

export { getXrpBalanceDrops };

export function buildMintTx(opts: {
  account: string;
  metadataUrl: string;
  taxon: number;
  transferFee?: number;
  flags?: number;
}): NFTokenMint {
  if (opts.taxon < 0 || opts.taxon > 0xffffffff) {
    throw new Error("NFTokenTaxon must fit in a uint32");
  }
  const flags = opts.flags ?? DEFAULT_MINT_FLAGS;
  const tx: NFTokenMint = {
    TransactionType: "NFTokenMint",
    Account: opts.account,
    URI: encodeUri(opts.metadataUrl),
    Flags: flags,
    NFTokenTaxon: opts.taxon,
  };
  const fee = opts.transferFee ?? 0;
  if (fee < 0 || fee > MAX_TRANSFER_FEE) {
    throw new Error("TransferFee must be 0–50000 (1000 = 1%)");
  }
  if (fee > 0) {
    tx.TransferFee = fee;
  }
  return tx;
}

export function buildSellOfferTx(opts: {
  account: string;
  nftokenID: string;
  amountDrops: string;
  destination?: string;
  expiration?: number;
}): NFTokenCreateOffer {
  const tx: NFTokenCreateOffer = {
    TransactionType: "NFTokenCreateOffer",
    Account: opts.account,
    NFTokenID: opts.nftokenID,
    Amount: opts.amountDrops,
    Flags: TF_SELL_TOKEN,
  };
  if (opts.destination) tx.Destination = opts.destination;
  if (opts.expiration) tx.Expiration = opts.expiration;
  return tx;
}

export function buildBuyOfferTx(opts: {
  account: string;
  owner: string;
  nftokenID: string;
  amountDrops: string;
  destination?: string;
  expiration?: number;
}): NFTokenCreateOffer {
  const tx: NFTokenCreateOffer = {
    TransactionType: "NFTokenCreateOffer",
    Account: opts.account,
    Owner: opts.owner,
    NFTokenID: opts.nftokenID,
    Amount: opts.amountDrops,
  };
  if (opts.destination) tx.Destination = opts.destination;
  if (opts.expiration) tx.Expiration = opts.expiration;
  return tx;
}

export function buildAcceptSellOfferTx(opts: {
  account: string;
  sellOfferIndex: string;
}): NFTokenAcceptOffer {
  return {
    TransactionType: "NFTokenAcceptOffer",
    Account: opts.account,
    NFTokenSellOffer: opts.sellOfferIndex,
  };
}

export function buildBrokerAcceptTx(opts: {
  brokerAccount: string;
  sellOfferIndex: string;
  buyOfferIndex: string;
  brokerFeeDrops: string;
}): NFTokenAcceptOffer {
  const tx: NFTokenAcceptOffer = {
    TransactionType: "NFTokenAcceptOffer",
    Account: opts.brokerAccount,
    NFTokenSellOffer: opts.sellOfferIndex,
    NFTokenBuyOffer: opts.buyOfferIndex,
  };
  if (opts.brokerFeeDrops !== "0") {
    tx.NFTokenBrokerFee = opts.brokerFeeDrops;
  }
  return tx;
}

export function buildCancelOfferTx(opts: {
  account: string;
  offerIndexes: string[];
}): NFTokenCancelOffer {
  return {
    TransactionType: "NFTokenCancelOffer",
    Account: opts.account,
    NFTokenOffers: opts.offerIndexes,
  };
}

export function listingDestination(): string | undefined {
  const dest = brokerAddress();
  return brokerConfigured() ? dest : undefined;
}

type TokenOnPage = { NFToken: { NFTokenID: string } };

export function extractNFTokenID(result: TxResponse): string | undefined {
  const meta = result.result.meta;
  if (!meta || typeof meta === "string") return undefined;
  const typed = meta as TransactionMetadata & { nftoken_id?: string };
  if (typed.nftoken_id) return typed.nftoken_id;

  for (const node of typed.AffectedNodes ?? []) {
    if ("CreatedNode" in node && node.CreatedNode.LedgerEntryType === "NFTokenPage") {
      const tokens = node.CreatedNode.NewFields.NFTokens as TokenOnPage[] | undefined;
      if (tokens?.length) return tokens[tokens.length - 1]?.NFToken.NFTokenID;
    }
    if ("ModifiedNode" in node && node.ModifiedNode.LedgerEntryType === "NFTokenPage") {
      const prev =
        (node.ModifiedNode.PreviousFields?.NFTokens as TokenOnPage[] | undefined) ?? [];
      const next =
        (node.ModifiedNode.FinalFields?.NFTokens as TokenOnPage[] | undefined) ?? [];
      const prevIds = new Set(prev.map((t) => t.NFToken.NFTokenID));
      const added = next.find((t) => !prevIds.has(t.NFToken.NFTokenID));
      if (added) return added.NFToken.NFTokenID;
    }
  }
  return undefined;
}

export function extractOfferIndex(result: TxResponse): string | undefined {
  const meta = result.result.meta;
  if (!meta || typeof meta === "string") return undefined;
  const typed = meta as TransactionMetadata & { offer_id?: string };
  if (typed.offer_id) return typed.offer_id;
  for (const node of typed.AffectedNodes ?? []) {
    if ("CreatedNode" in node && node.CreatedNode.LedgerEntryType === "NFTokenOffer") {
      return node.CreatedNode.LedgerIndex;
    }
  }
  return undefined;
}

export async function getAccountNfts(account: string): Promise<AccountNFToken[]> {
  const client = await getClient();
  const all: AccountNFToken[] = [];
  let marker: unknown;
  do {
    const res = await client.request({
      command: "account_nfts",
      account,
      limit: 400,
      marker,
    });
    all.push(...res.result.account_nfts);
    marker = res.result.marker;
  } while (marker);
  return all;
}

export async function getNftSellOffers(nftId: string): Promise<NftOffer[]> {
  const client = await getClient();
  try {
    const res = await client.request({ command: "nft_sell_offers", nft_id: nftId });
    return (res.result.offers ?? []).map(mapRpcOffer);
  } catch {
    return [];
  }
}

export async function getNftBuyOffers(nftId: string): Promise<NftOffer[]> {
  const client = await getClient();
  try {
    const res = await client.request({ command: "nft_buy_offers", nft_id: nftId });
    return (res.result.offers ?? []).map(mapRpcOffer);
  } catch {
    return [];
  }
}

function mapRpcOffer(offer: {
  amount: string | { currency: string; issuer: string; value: string };
  flags: number;
  nft_offer_index: string;
  owner: string;
  destination?: string;
  expiration?: number;
}): NftOffer {
  return {
    nft_offer_index: offer.nft_offer_index,
    flags: offer.flags,
    owner: offer.owner,
    amount: typeof offer.amount === "string" ? offer.amount : "",
    destination: offer.destination,
    expiration: offer.expiration,
  };
}

export async function getNftInfo(nftId: string) {
  const client = await getClioClient();
  const res = await client.request({ command: "nft_info", nft_id: nftId });
  return res.result;
}

export async function getNftsByIssuer(issuer: string, taxon?: number) {
  const client = await getClioClient();
  const res = await client.request({
    command: "nfts_by_issuer",
    issuer,
    nft_taxon: taxon,
    limit: 50,
  });
  return res.result;
}

export type AccountNftOffer = {
  index: string;
  nftokenID: string;
  amountDrops: string;
  flags: number;
  owner: string;
  destination?: string;
  expiration?: number;
  isSell: boolean;
};

export async function getAccountNftOffers(account: string): Promise<AccountNftOffer[]> {
  const client = await getClient();
  const res = await client.request({
    command: "account_objects",
    account,
    type: "nft_offer",
    limit: 400,
  });
  return res.result.account_objects.flatMap((obj) => {
    const row = obj as unknown as {
      index?: string;
      NFTokenID?: string;
      Amount?: string | Record<string, unknown>;
      Flags?: number;
      Owner?: string;
      Destination?: string;
      Expiration?: number;
    };
    if (!row.index || !row.NFTokenID) return [];
    const amount = typeof row.Amount === "string" ? row.Amount : "";
    const flags = row.Flags ?? 0;
    return [
      {
        index: row.index,
        nftokenID: row.NFTokenID,
        amountDrops: amount,
        flags,
        owner: row.Owner ?? account,
        destination: row.Destination,
        expiration: row.Expiration,
        isSell: (flags & TF_SELL_TOKEN) === TF_SELL_TOKEN,
      },
    ];
  });
}

export function decodedUriOf(nft: { URI?: string; uri?: string }): string {
  return decodeUri(nft.URI ?? nft.uri ?? "");
}

export async function submitAutofilled(
  tx: SubmittableTransaction,
  sign: (prepared: SubmittableTransaction) => { tx_blob: string; hash: string },
): Promise<TxOutcome & { result: TxResponse }> {
  const client = await getClient();
  const prepared = await client.autofill(tx);
  const signed = sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  return { ...outcomeFromTx(result), result };
}
