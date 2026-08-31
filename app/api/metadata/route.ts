import { NextResponse } from "next/server";
import { parseMetadata } from "@/lib/metadata";
import { persistMetadata, pinFileToPinata, pinMetadataToPinata, publicAppUrl } from "@/lib/metadata-store";
import { isHttpOrIpfs } from "@/lib/metadata";
import type { NftMetadata } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const uri = new URL(req.url).searchParams.get("uri");
  if (!uri) {
    return NextResponse.json({ error: "uri query is required" }, { status: 400 });
  }
  try {
    const res = await fetch(uri, { headers: { Accept: "application/json,image/*,*/*" } });
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream ${res.status}` }, { status: res.status });
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json") || uri.endsWith(".json")) {
      const json = parseMetadata(await res.json());
      if (!json) return NextResponse.json({ error: "Invalid metadata JSON" }, { status: 422 });
      return NextResponse.json(json);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return new NextResponse(buf, {
      headers: { "Content-Type": contentType || "application/octet-stream" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Metadata proxy failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file field required" }, { status: 400 });
      }
      const uri = await pinFileToPinata(file, file.name || "nft.png");
      return NextResponse.json({ uri });
    }

    const body = (await req.json()) as Partial<NftMetadata> & { image?: string };
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (body.image && !isHttpOrIpfs(body.image)) {
      return NextResponse.json({ error: "image must be an HTTPS or ipfs:// URI" }, { status: 400 });
    }
    const json: NftMetadata = {
      name: body.name,
      description: body.description ?? "",
      image: body.image ?? "",
      attributes: Array.isArray(body.attributes)
        ? body.attributes.map((a) => ({
            trait_type: String(a.trait_type ?? ""),
            value: String(a.value ?? ""),
          }))
        : [],
    };
    const pinned = await pinMetadataToPinata(json);
    if (pinned) {
      return NextResponse.json({ uri: pinned, metadata: json });
    }
    const id = await persistMetadata(json);
    const uri = `${publicAppUrl()}/api/metadata/${id}`;
    return NextResponse.json({ uri, metadata: json, hosted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to store metadata";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
