import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { NftMetadata } from "./types";

const META_DIR = path.join(process.cwd(), "data", "metadata");

export function publicAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function metadataId(json: NftMetadata): string {
  return createHash("sha256").update(JSON.stringify(json)).digest("hex").slice(0, 24);
}

export async function persistMetadata(json: NftMetadata): Promise<string> {
  await fs.mkdir(META_DIR, { recursive: true });
  const id = metadataId(json);
  await fs.writeFile(path.join(META_DIR, `${id}.json`), JSON.stringify(json, null, 2), "utf8");
  return id;
}

export async function readPersistedMetadata(id: string): Promise<NftMetadata | null> {
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(META_DIR, `${id}.json`), "utf8");
    return JSON.parse(raw) as NftMetadata;
  } catch {
    return null;
  }
}

/**
 * TODO: production markets should pin image + JSON to IPFS (Pinata, NFT.storage, etc).
 * When PINATA_JWT is set we pin JSON; otherwise metadata is served from /api/metadata/[id].
 */
export async function pinMetadataToPinata(json: NftMetadata): Promise<string | null> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return null;
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pinataContent: json, pinataMetadata: { name: json.name } }),
  });
  if (!res.ok) {
    throw new Error(`Pinata JSON pin failed (${res.status})`);
  }
  const body = (await res.json()) as { IpfsHash?: string };
  if (!body.IpfsHash) throw new Error("Pinata response missing IpfsHash");
  return `ipfs://${body.IpfsHash}`;
}

export async function pinFileToPinata(bytes: Blob, filename: string): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    throw new Error("PINATA_JWT is not set — paste an HTTPS or ipfs:// image URL instead");
  }
  const form = new FormData();
  form.append("file", bytes, filename);
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata file pin failed (${res.status})`);
  const body = (await res.json()) as { IpfsHash?: string };
  if (!body.IpfsHash) throw new Error("Pinata response missing IpfsHash");
  return `ipfs://${body.IpfsHash}`;
}
