"use client";

import { useState } from "react";
import { isDevSeedEnabled, type WalletType } from "@/lib/wallets";
import { classNames } from "@/lib/format";
import { useWallet } from "./WalletProvider";

const OPTIONS: { type: WalletType; label: string; hint: string; hidden?: boolean }[] = [
  { type: "xaman", label: "Xaman", hint: "Mobile QR / deep link" },
  { type: "crossmark", label: "Crossmark", hint: "Browser extension" },
  { type: "gemwallet", label: "GemWallet", hint: "Browser extension" },
  {
    type: "dev",
    label: "Dev seed",
    hint: "Testnet only · NODE_ENV=development",
    hidden: !isDevSeedEnabled(),
  },
];

export function WalletButton() {
  const { wallet, connecting, connect, disconnect, error, xaman, clearError } = useWallet();
  const [open, setOpen] = useState(false);

  if (wallet) {
    return (
      <button
        type="button"
        onClick={disconnect}
        className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-mist hover:border-lime hover:text-lime"
      >
        Disconnect
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          clearError();
        }}
        className="rounded-full bg-lime px-4 py-1.5 text-sm font-semibold text-ink-950 hover:bg-white"
      >
        {connecting ? "Connecting…" : "Connect"}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-line bg-ink-800 p-2 shadow-xl">
          {OPTIONS.filter((o) => !o.hidden).map((opt) => (
            <button
              key={opt.type}
              type="button"
              disabled={connecting}
              onClick={async () => {
                try {
                  await connect(opt.type);
                  setOpen(false);
                } catch {
                  /* shown via error */
                }
              }}
              className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-ink-700"
            >
              <span className="text-sm font-medium">{opt.label}</span>
              <span className="text-xs text-mist">{opt.hint}</span>
            </button>
          ))}
          {error ? <p className="px-3 py-2 text-xs text-[#ff8a70]">{error}</p> : null}
        </div>
      ) : null}
      {xaman ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-ink-800 p-5">
            <p className="font-display text-lg">Scan with Xaman</p>
            {xaman.qrPng ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={xaman.qrPng} alt="Xaman QR" className="mx-auto my-4 h-52 w-52 rounded-lg bg-white p-2" />
            ) : (
              <p className="py-8 text-center text-sm text-mist">Waiting for QR…</p>
            )}
            <a
              href={xaman.deepLink}
              className={classNames(
                "block rounded-full bg-lime py-2 text-center text-sm font-semibold text-ink-950",
              )}
            >
              Open in Xaman
            </a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-3 w-full text-center text-xs text-mist"
            >
              Hide panel — keep this tab open while you sign
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
