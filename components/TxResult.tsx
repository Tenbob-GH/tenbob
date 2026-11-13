"use client";

import type { TxOutcome } from "@/lib/types";
import { CopyButton } from "./CopyButton";

export function TxResult({ outcome }: { outcome: TxOutcome | null }) {
  if (!outcome) return null;
  const good = outcome.ok;
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        good ? "border-lime/40 bg-lime/10 text-lime" : "border-[#ff8a70]/40 bg-[#ff8a70]/10 text-[#ff8a70]"
      }`}
    >
      <p className="font-mono font-medium">{outcome.engineResult}</p>
      {outcome.engineResultMessage ? (
        <p className="mt-1 text-xs opacity-90">{outcome.engineResultMessage}</p>
      ) : null}
      {outcome.hash ? (
        <p className="mt-2 text-xs">
          Hash <CopyButton value={outcome.hash} label={outcome.hash} className="break-all" />
        </p>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
      <p className="font-display text-2xl">{title}</p>
      <p className="mt-2 text-sm text-mist">{body}</p>
    </div>
  );
}

export function LoadingBlock({ label = "Talking to the ledger…" }: { label?: string }) {
  return (
    <div className="animate-pulse rounded-2xl border border-line bg-ink-800 px-6 py-12 text-center text-sm text-mist">
      {label}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-[#ff8a70]/40 bg-[#ff8a70]/10 px-4 py-3 text-sm text-[#ff8a70]">
      {message}
    </div>
  );
}
