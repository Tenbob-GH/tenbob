import type { SubmittableTransaction } from "xrpl";
import { Wallet } from "xrpl";
import { outcomeFromEngine, type TxOutcome } from "./engine";
import { submitAutofilled } from "./nft";
import type { WalletType } from "./types";

export type { WalletType };

export type ConnectedWallet = {
  address: string;
  type: WalletType;
};

export type SignAndSubmit = (txJson: Record<string, unknown>) => Promise<TxOutcome>;

const STORAGE_KEY = "tenbob.wallet";

export function loadStoredWallet(): ConnectedWallet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConnectedWallet;
    if (!parsed.address || !parsed.type) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeWallet(wallet: ConnectedWallet) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
}

export function clearStoredWallet() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isDevSeedEnabled(): boolean {
  return process.env.NODE_ENV === "development" && Boolean(process.env.NEXT_PUBLIC_DEV_SEED);
}

export async function connectCrossmark(): Promise<string> {
  if (typeof window === "undefined") throw new Error("Crossmark is browser-only");
  const mod = await import("@crossmarkio/sdk");
  const sdk = mod.default;
  const installed = sdk.sync.isInstalled();
  if (installed === false) {
    throw new Error("Crossmark extension is not installed");
  }
  const res = await sdk.methods.signInAndWait();
  const address =
    sdk.sync.getAddress() ||
    pickString(res, ["response.data.address", "response.address", "address"]);
  if (!address) throw new Error("Crossmark did not return an address");
  return address;
}

export async function connectGemWallet(): Promise<string> {
  if (typeof window === "undefined") throw new Error("GemWallet is browser-only");
  const { isInstalled, getAddress } = await import("@gemwallet/api");
  const installed = await isInstalled();
  if (!installed.result?.isInstalled) {
    throw new Error("GemWallet extension is not installed");
  }
  const addr = await getAddress();
  const address = addr.result?.address;
  if (!address) throw new Error("GemWallet did not return an address");
  return address;
}

export function connectDevSeed(): string {
  if (!isDevSeedEnabled()) {
    throw new Error("Dev seed wallet is only available in development");
  }
  const seed = process.env.NEXT_PUBLIC_DEV_SEED;
  if (!seed) throw new Error("NEXT_PUBLIC_DEV_SEED is not set");
  return Wallet.fromSeed(seed).classicAddress;
}

export async function signAndSubmit(
  type: WalletType,
  address: string,
  txJson: Record<string, unknown>,
  xaman?: XamanHooks,
): Promise<TxOutcome> {
  const tx = { ...txJson, Account: address };
  switch (type) {
    case "crossmark":
      return signCrossmark(tx);
    case "gemwallet":
      return signGemWallet(tx);
    case "xaman":
      if (!xaman) throw new Error("Xaman UI hooks missing");
      return signXaman(tx, xaman);
    case "dev":
      return signDev(tx);
    default:
      throw new Error(`Unknown wallet type: ${type}`);
  }
}

async function signCrossmark(tx: Record<string, unknown>): Promise<TxOutcome> {
  const mod = await import("@crossmarkio/sdk");
  const sdk = mod.default;
  const res = await sdk.methods.signAndSubmitAndWait(tx as never);
  const hash = pickString(res, [
    "response.data.resp.result.hash",
    "response.data.data.hash",
    "response.data.hash",
    "response.hash",
  ]);
  const engine =
    pickString(res, [
      "response.data.resp.result.meta.TransactionResult",
      "response.data.resp.engine_result",
      "response.data.meta",
    ]) || "tesSUCCESS";
  if (!hash && engine !== "tesSUCCESS") {
    throw new Error(engine);
  }
  return outcomeFromEngine(typeof engine === "string" ? engine : "tesSUCCESS", hash);
}

async function signGemWallet(tx: Record<string, unknown>): Promise<TxOutcome> {
  const { submitTransaction } = await import("@gemwallet/api");
  const res = await submitTransaction({
    transaction: tx as unknown as SubmittableTransaction,
  });
  if (res.type !== "response" || !res.result?.hash) {
    throw new Error("GemWallet rejected the transaction");
  }
  return outcomeFromEngine("tesSUCCESS", res.result.hash);
}

function signDev(tx: Record<string, unknown>): Promise<TxOutcome> {
  if (!isDevSeedEnabled()) {
    throw new Error("Dev seed wallet is only available in development");
  }
  const seed = process.env.NEXT_PUBLIC_DEV_SEED;
  if (!seed) throw new Error("NEXT_PUBLIC_DEV_SEED is not set");
  const wallet = Wallet.fromSeed(seed);
  if (tx.Account && tx.Account !== wallet.classicAddress) {
    throw new Error("Dev seed does not match the connected address");
  }
  return submitAutofilled(tx as unknown as SubmittableTransaction, (prepared) =>
    wallet.sign(prepared),
  ).then((outcome) => ({
    ok: outcome.ok,
    hash: outcome.hash,
    engineResult: outcome.engineResult,
    engineResultMessage: outcome.engineResultMessage,
    kind: outcome.kind,
  }));
}

export type XamanHooks = {
  onPayload: (info: { uuid: string; qrPng: string; deepLink: string }) => void;
  onSettled: () => void;
};

async function signXaman(tx: Record<string, unknown>, hooks: XamanHooks): Promise<TxOutcome> {
  const created = await fetch("/api/xaman/payload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      txjson: { ...tx, TransactionType: tx.TransactionType },
      submit: true,
    }),
  });
  const body = (await created.json()) as {
    error?: string;
    uuid?: string;
    qrPng?: string;
    deepLink?: string;
  };
  if (!created.ok || !body.uuid) {
    throw new Error(body.error ?? "Xaman payload create failed");
  }
  hooks.onPayload({ uuid: body.uuid, qrPng: body.qrPng ?? "", deepLink: body.deepLink ?? "" });
  try {
    return await pollXaman(body.uuid);
  } finally {
    hooks.onSettled();
  }
}

export async function createXamanSignIn(hooks: XamanHooks): Promise<string> {
  const created = await fetch("/api/xaman/payload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      txjson: { TransactionType: "SignIn" },
      submit: false,
    }),
  });
  const body = (await created.json()) as {
    error?: string;
    uuid?: string;
    qrPng?: string;
    deepLink?: string;
  };
  if (!created.ok || !body.uuid) {
    throw new Error(body.error ?? "Xaman payload create failed");
  }
  hooks.onPayload({ uuid: body.uuid, qrPng: body.qrPng ?? "", deepLink: body.deepLink ?? "" });
  try {
    const outcome = await pollXaman(body.uuid, true);
    if (!outcome.hash) {
      /* SignIn has no tx hash; address is returned in engineResultMessage slot by poll */
    }
    const address = (outcome as TxOutcome & { address?: string }).address;
    if (!address) throw new Error("Xaman SignIn did not return an account");
    return address;
  } finally {
    hooks.onSettled();
  }
}

type XamanPoll = TxOutcome & { address?: string };

async function pollXaman(uuid: string, signIn = false): Promise<XamanPoll> {
  const started = Date.now();
  while (Date.now() - started < 5 * 60 * 1000) {
    const res = await fetch(`/api/xaman/payload/${uuid}`);
    const body = (await res.json()) as {
      error?: string;
      signed?: boolean;
      cancelled?: boolean;
      expired?: boolean;
      account?: string | null;
      txid?: string | null;
      dispatchedResult?: string | null;
    };
    if (!res.ok) throw new Error(body.error ?? "Xaman poll failed");
    if (body.cancelled) throw new Error("Xaman request cancelled");
    if (body.expired) throw new Error("Xaman request expired");
    if (body.signed) {
      const engine = body.dispatchedResult ?? (signIn ? "tesSUCCESS" : "tesSUCCESS");
      return {
        ...outcomeFromEngine(engine, body.txid ?? undefined),
        address: body.account ?? undefined,
      };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Timed out waiting for Xaman");
}

function pickString(obj: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const key of path.split(".")) {
      if (cur && typeof cur === "object" && key in cur) {
        cur = (cur as Record<string, unknown>)[key];
      } else {
        cur = undefined;
        break;
      }
    }
    if (typeof cur === "string" && cur.length) return cur;
  }
  return undefined;
}
