"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  clearStoredWallet,
  connectCrossmark,
  connectDevSeed,
  connectGemWallet,
  createXamanSignIn,
  isDevSeedEnabled,
  loadStoredWallet,
  signAndSubmit,
  storeWallet,
  type ConnectedWallet,
  type WalletType,
  type XamanHooks,
} from "@/lib/wallets";
import { getXrpBalanceDrops } from "@/lib/nft";
import type { TxOutcome } from "@/lib/types";
import { formatError } from "@/lib/format";

type XamanUi = { qrPng: string; deepLink: string } | null;

type WalletContextValue = {
  wallet: ConnectedWallet | null;
  balanceDrops: string | null;
  connecting: boolean;
  error: string | null;
  xaman: XamanUi;
  connect: (type: WalletType) => Promise<void>;
  disconnect: () => void;
  signAndSubmit: (txJson: Record<string, unknown>) => Promise<TxOutcome>;
  refreshBalance: () => Promise<void>;
  clearError: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [balanceDrops, setBalanceDrops] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [xaman, setXaman] = useState<XamanUi>(null);

  const xamanHooks: XamanHooks = useMemo(
    () => ({
      onPayload: (info) => setXaman({ qrPng: info.qrPng, deepLink: info.deepLink }),
      onSettled: () => setXaman(null),
    }),
    [],
  );

  const refreshBalance = useCallback(async () => {
    if (!wallet) {
      setBalanceDrops(null);
      return;
    }
    try {
      const drops = await getXrpBalanceDrops(wallet.address);
      setBalanceDrops(drops);
    } catch {
      setBalanceDrops(null);
    }
  }, [wallet]);

  useEffect(() => {
    const stored = loadStoredWallet();
    if (stored) setWallet(stored);
  }, []);

  useEffect(() => {
    void refreshBalance();
    if (!wallet) return;
    const id = setInterval(() => void refreshBalance(), 20_000);
    return () => clearInterval(id);
  }, [wallet, refreshBalance]);

  const connect = useCallback(async (type: WalletType) => {
    setConnecting(true);
    setError(null);
    try {
      let address: string;
      if (type === "crossmark") address = await connectCrossmark();
      else if (type === "gemwallet") address = await connectGemWallet();
      else if (type === "xaman") address = await createXamanSignIn(xamanHooks);
      else if (type === "dev") {
        if (!isDevSeedEnabled()) throw new Error("Dev seed is hidden outside development");
        address = connectDevSeed();
      } else {
        throw new Error("Unsupported wallet");
      }
      const next = { address, type };
      storeWallet(next);
      setWallet(next);
    } catch (err) {
      setError(formatError(err));
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [xamanHooks]);

  const disconnect = useCallback(() => {
    clearStoredWallet();
    setWallet(null);
    setBalanceDrops(null);
  }, []);

  const submit = useCallback(
    async (txJson: Record<string, unknown>) => {
      if (!wallet) throw new Error("Connect a wallet first");
      setError(null);
      try {
        return await signAndSubmit(wallet.type, wallet.address, txJson, xamanHooks);
      } catch (err) {
        setError(formatError(err));
        throw err;
      }
    },
    [wallet, xamanHooks],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      balanceDrops,
      connecting,
      error,
      xaman,
      connect,
      disconnect,
      signAndSubmit: submit,
      refreshBalance,
      clearError: () => setError(null),
    }),
    [wallet, balanceDrops, connecting, error, xaman, connect, disconnect, submit, refreshBalance],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
