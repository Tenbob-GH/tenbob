"use client";

import { FormEvent, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/components/WalletProvider";
import { ErrorBlock, TxResult } from "@/components/TxResult";
import { isHttpOrIpfs } from "@/lib/metadata";
import { buildMintTx, DEFAULT_MINT_FLAGS, extractNFTokenID } from "@/lib/nft";
import { ingestHash } from "@/lib/client";
import { getClient } from "@/lib/xrpl";
import type { NftAttribute, TxOutcome } from "@/lib/types";
import { formatError } from "@/lib/format";

export default function CreatePage() {
  const { wallet, signAndSubmit, refreshBalance } = useWallet();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [taxon, setTaxon] = useState("0");
  const [royalty, setRoyalty] = useState("0");
  const [burnable, setBurnable] = useState(true);
  const [transferable, setTransferable] = useState(true);
  const [attributes, setAttributes] = useState<NftAttribute[]>([{ trait_type: "", value: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<TxOutcome | null>(null);

  const flags = useMemo(() => {
    let value = 0;
    if (burnable) value |= 1;
    if (transferable) value |= 8;
    return value || DEFAULT_MINT_FLAGS;
  }, [burnable, transferable]);

  const transferFee = useMemo(() => {
    const pct = Number(royalty);
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    return Math.min(50_000, Math.round(pct * 1000));
  }, [royalty]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOutcome(null);
    if (!wallet) {
      setError("Connect a wallet first.");
      return;
    }
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!isHttpOrIpfs(image)) {
      setError("Image must be an HTTPS or ipfs:// URI. File upload needs PINATA_JWT.");
      return;
    }
    const taxonNum = Number(taxon);
    if (!Number.isInteger(taxonNum) || taxonNum < 0) {
      setError("Taxon must be a non-negative integer (collection id).");
      return;
    }
    if (!transferable && transferFee > 0) {
      setError("TransferFee requires the transferable flag.");
      return;
    }
    setBusy(true);
    try {
      const metaRes = await fetch("/api/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description,
          image: image.trim(),
          attributes: attributes.filter((a) => a.trait_type && a.value),
        }),
      });
      const metaBody = (await metaRes.json()) as { uri?: string; error?: string };
      if (!metaRes.ok || !metaBody.uri) {
        throw new Error(metaBody.error ?? "Failed to store metadata");
      }
      const tx = buildMintTx({
        account: wallet.address,
        metadataUrl: metaBody.uri,
        taxon: taxonNum,
        transferFee,
        flags,
      });
      const result = await signAndSubmit(tx as unknown as Record<string, unknown>);
      setOutcome(result);
      if (result.hash) await ingestHash(result.hash);
      await refreshBalance();
      if (result.ok && result.hash) {
        const client = await getClient();
        const txRes = await client.request({ command: "tx", transaction: result.hash });
        const nftId = extractNFTokenID(txRes as never);
        if (nftId) {
          router.push(`/nft/${nftId}`);
          return;
        }
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-lime">NFTokenMint</p>
        <h1 className="font-display text-4xl">Mint on Testnet</h1>
        <p className="mt-2 text-sm text-mist">
          URI is stored as hex via <span className="font-mono">convertStringToHex</span>. Default
          flags are 9 (burnable + transferable). TransferFee 1000 = 1%, max 50000.
        </p>
      </div>

      {!wallet ? <ErrorBlock message="Connect a wallet to mint. Keys never leave the wallet." /> : null}
      {error ? <ErrorBlock message={error} /> : null}
      <TxResult outcome={outcome} />

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-line bg-ink-800 p-5">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" required />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="input"
          />
        </Field>
        <Field label="Image URI (HTTPS or ipfs://)">
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="https://… or ipfs://…"
            className="input"
          />
        </Field>
        <Field label="Image file (Pinata stub)">
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError(null);
              const form = new FormData();
              form.append("file", file);
              const res = await fetch("/api/metadata", { method: "POST", body: form });
              const body = (await res.json()) as { uri?: string; error?: string };
              if (!res.ok) {
                setError(
                  body.error ??
                    "File upload requires PINATA_JWT. Paste an HTTPS or ipfs:// URI instead.",
                );
                return;
              }
              if (body.uri) setImage(body.uri);
            }}
            className="text-sm text-mist"
          />
          <p className="mt-1 text-xs text-mist">
            TODO: production IPFS pin. Without PINATA_JWT this stays a URL field.
          </p>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Taxon (collection id)">
            <input
              value={taxon}
              onChange={(e) => setTaxon(e.target.value)}
              type="number"
              min={0}
              className="input"
            />
          </Field>
          <Field label="Royalty % (0–50)">
            <input
              value={royalty}
              onChange={(e) => setRoyalty(e.target.value)}
              type="number"
              min={0}
              max={50}
              step="0.1"
              className="input"
            />
          </Field>
        </div>
        <p className="text-xs text-mist">
          On-chain TransferFee = {transferFee} · Flags = {flags}
        </p>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={burnable} onChange={(e) => setBurnable(e.target.checked)} />
            Burnable
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={transferable}
              onChange={(e) => setTransferable(e.target.checked)}
            />
            Transferable
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-mist">Attributes</p>
          {attributes.map((attr, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <input
                placeholder="trait_type"
                value={attr.trait_type}
                className="input"
                onChange={(e) => {
                  const next = [...attributes];
                  next[i] = { ...attr, trait_type: e.target.value };
                  setAttributes(next);
                }}
              />
              <input
                placeholder="value"
                value={attr.value}
                className="input"
                onChange={(e) => {
                  const next = [...attributes];
                  next[i] = { ...attr, value: e.target.value };
                  setAttributes(next);
                }}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setAttributes([...attributes, { trait_type: "", value: "" }])}
            className="text-xs text-lime"
          >
            Add trait
          </button>
        </div>
        <button
          type="submit"
          disabled={busy || !wallet}
          className="w-full rounded-xl bg-lime py-2.5 font-semibold text-ink-950 disabled:opacity-40"
        >
          {busy ? "Minting…" : "Mint NFToken"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wide text-mist">{label}</span>
      {children}
    </label>
  );
}
