import type { NftMetadata } from "./types";

const MEMORY = new Map<string, { at: number; data: NftMetadata }>();
const TTL_MS = 10 * 60 * 1000;

export function ipfsToHttp(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    const rest = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
    const gateway =
      process.env.NEXT_PUBLIC_IPFS_GATEWAY ||
      process.env.PINATA_GATEWAY ||
      "https://ipfs.io";
    return `${gateway.replace(/\/$/, "")}/ipfs/${rest}`;
  }
  return uri;
}

export function isHttpOrIpfs(uri: string): boolean {
  return /^(https?:\/\/|ipfs:\/\/)/i.test(uri.trim());
}

export function cacheGet(uri: string): NftMetadata | null {
  const hit = MEMORY.get(uri);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  return null;
}

export function cacheSet(uri: string, data: NftMetadata) {
  const entry = { at: Date.now(), data };
  MEMORY.set(uri, entry);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`tenbob.meta.${uri}`, JSON.stringify(entry));
    } catch {
      /* quota */
    }
  }
}

export function cacheGetLocal(uri: string): NftMetadata | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`tenbob.meta.${uri}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: NftMetadata };
    if (Date.now() - parsed.at < TTL_MS) {
      MEMORY.set(uri, parsed);
      return parsed.data;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function parseMetadata(json: unknown): NftMetadata | null {
  if (!json || typeof json !== "object") return null;
  const row = json as Partial<NftMetadata>;
  if (typeof row.name !== "string") return null;
  return {
    name: row.name,
    description: typeof row.description === "string" ? row.description : "",
    image: typeof row.image === "string" ? row.image : "",
    attributes: Array.isArray(row.attributes)
      ? row.attributes.map((a) => ({
          trait_type: String((a as { trait_type?: unknown }).trait_type ?? ""),
          value: String((a as { value?: unknown }).value ?? ""),
        }))
      : [],
  };
}

export async function fetchMetadataJson(uri: string): Promise<NftMetadata | null> {
  const cached = cacheGet(uri) ?? cacheGetLocal(uri);
  if (cached) return cached;
  const url = ipfsToHttp(uri);
  if (!url) return null;
  const proxied =
    typeof window !== "undefined"
      ? `/api/metadata?uri=${encodeURIComponent(url)}`
      : url;
  const res = await fetch(proxied, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = parseMetadata(await res.json());
  if (!data) return null;
  cacheSet(uri, data);
  return data;
}
