export type WalletType = "xaman" | "crossmark" | "gemwallet" | "dev";

export type NftAttribute = {
  trait_type: string;
  value: string;
};

export type NftMetadata = {
  name: string;
  description: string;
  image: string;
  attributes: NftAttribute[];
};

export type ListingStatus =
  | "minted"
  | "listed"
  | "sold"
  | "canceled"
  | "burned";

export type Listing = {
  nft_id: string;
  issuer: string;
  taxon: number;
  owner: string;
  uri: string;
  sell_offer_index: string | null;
  price_drops: string | null;
  destination: string | null;
  status: ListingStatus;
  updated_at: string;
  metadata?: NftMetadata | null;
};

export type NftOffer = {
  nft_offer_index: string;
  flags: number;
  owner: string;
  amount: string;
  destination?: string;
  expiration?: number;
  nft_id?: string;
};

export type EngineKind = "tes" | "tec" | "ter" | "tef" | "tem" | "tel" | "unknown";

export type TxOutcome = {
  ok: boolean;
  hash?: string;
  engineResult: string;
  engineResultMessage?: string;
  kind: EngineKind;
};
