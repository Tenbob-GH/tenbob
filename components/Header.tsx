"use client";

import Link from "next/link";
import { useWallet } from "./WalletProvider";
import { WalletButton } from "./WalletButton";
import { CopyButton } from "./CopyButton";
import { formatXrp, networkLabel, XRPL_WS } from "@/lib/xrpl";
import { truncateMiddle } from "@/lib/format";
import { brokerConfigured, feePercentLabel } from "@/lib/broker";

export function Header() {
  const { wallet, balanceDrops } = useWallet();
  const net = networkLabel();

  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-ink-950/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="font-display text-xl tracking-tight">
          TENBOB
        </Link>
        <nav className="hidden items-center gap-4 text-sm text-mist sm:flex">
          <Link href="/" className="hover:text-lime">
            Market
          </Link>
          <Link href="/create" className="hover:text-lime">
            Mint
          </Link>
          {wallet ? (
            <Link href={`/profile/${wallet.address}`} className="hover:text-lime">
              Profile
            </Link>
          ) : null}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span
            className={`rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide ${
              net === "Mainnet"
                ? "border-[#ff8a70] text-[#ff8a70]"
                : "border-lime/40 text-lime"
            }`}
            title={XRPL_WS}
          >
            {net}
          </span>
          {brokerConfigured() ? (
            <span className="hidden rounded-full border border-line px-2.5 py-1 text-[11px] text-mist md:inline">
              Fee {feePercentLabel()}
            </span>
          ) : (
            <span className="hidden rounded-full border border-line px-2.5 py-1 text-[11px] text-mist md:inline">
              0% fee
            </span>
          )}
          {wallet ? (
            <div className="hidden items-center gap-2 sm:flex">
              <CopyButton value={wallet.address} label={truncateMiddle(wallet.address, 6, 4)} />
              <span className="font-mono text-sm">
                {balanceDrops ? `${formatXrp(balanceDrops)} XRP` : "—"}
              </span>
            </div>
          ) : null}
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
