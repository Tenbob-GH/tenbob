import { NextResponse } from "next/server";
import { readPersistedMetadata } from "@/lib/metadata-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const json = await readPersistedMetadata(id);
  if (!json) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(json);
}
