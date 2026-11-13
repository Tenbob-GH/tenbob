import {
  Client,
  convertHexToString,
  convertStringToHex,
  dropsToXrp,
  xrpToDrops,
} from "xrpl";

export const XRPL_WS =
  process.env.NEXT_PUBLIC_XRPL_WS ?? "wss://s.altnet.rippletest.net:51233";

export const CLIO_WS = process.env.NEXT_PUBLIC_XRPL_CLIO_WS ?? XRPL_WS;

export const RIPPLE_EPOCH_OFFSET = 946684800;

export function networkLabel(url: string = XRPL_WS): "Testnet" | "Mainnet" | "Custom" {
  const u = url.toLowerCase();
  if (u.includes("altnet") || u.includes("testnet") || u.includes("devnet")) {
    return "Testnet";
  }
  if (
    u.includes("xrplcluster.com") ||
    u.includes("s1.ripple.com") ||
    u.includes("s2.ripple.com") ||
    u.includes("xrpl.ws")
  ) {
    return "Mainnet";
  }
  return "Custom";
}

export function toDrops(xrp: string | number): string {
  return xrpToDrops(String(xrp));
}

export function fromDrops(drops: string | number): string {
  return String(dropsToXrp(String(drops)));
}

export function formatXrp(drops: string | number, digits = 4): string {
  const value = Number(fromDrops(drops));
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/** NFTokenMint.URI is a hex blob of the metadata URL, not a UTF-8 string. */
export function encodeUri(uri: string): string {
  return convertStringToHex(uri).toUpperCase();
}

export function decodeUri(hexOrUri: string): string {
  if (!hexOrUri) return "";
  if (/^https?:\/\//i.test(hexOrUri) || hexOrUri.startsWith("ipfs://")) {
    return hexOrUri;
  }
  if (!/^[0-9a-fA-F]+$/.test(hexOrUri) || hexOrUri.length % 2 !== 0) {
    return hexOrUri;
  }
  try {
    const decoded = convertHexToString(hexOrUri);
    if ([...decoded].every((c) => {
      const code = c.charCodeAt(0);
      return code >= 32 && code !== 127;
    })) {
      return decoded;
    }
  } catch {
    /* keep hex */
  }
  return hexOrUri;
}

export function unixToRippleTime(unixSeconds: number): number {
  return unixSeconds - RIPPLE_EPOCH_OFFSET;
}

export function rippleToUnixTime(rippleTime: number): number {
  return rippleTime + RIPPLE_EPOCH_OFFSET;
}

type Slot = {
  client: Client | null;
  connecting: Promise<Client> | null;
};

const slots: Record<"main" | "clio", Slot> = {
  main: { client: null, connecting: null },
  clio: { client: null, connecting: null },
};

function attachReconnect(slot: Slot, url: string) {
  const client = slot.client;
  if (!client) return;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer) return;
    const delay = Math.min(1000 * 2 ** attempt, 15_000);
    attempt += 1;
    timer = setTimeout(async () => {
      timer = null;
      try {
        if (!slot.client?.isConnected()) {
          slot.client = new Client(url, { connectionTimeout: 15_000 });
          attachReconnect(slot, url);
          await slot.client.connect();
          attempt = 0;
        }
      } catch {
        schedule();
      }
    }, delay);
  };

  client.on("disconnected", () => schedule());
  client.on("connected", () => {
    attempt = 0;
  });
}

async function connectSlot(key: "main" | "clio", url: string): Promise<Client> {
  const slot = slots[key];
  if (slot.client?.isConnected()) return slot.client;
  if (slot.connecting) return slot.connecting;

  slot.connecting = (async () => {
    if (slot.client) {
      try {
        slot.client.removeAllListeners();
        await slot.client.disconnect();
      } catch {
        /* stale socket */
      }
    }
    const client = new Client(url, { connectionTimeout: 15_000 });
    slot.client = client;
    attachReconnect(slot, url);
    await client.connect();
    return client;
  })();

  try {
    return await slot.connecting;
  } finally {
    slot.connecting = null;
  }
}

/** Browser + server singleton. Do not construct a new Client per request. */
export async function getClient(): Promise<Client> {
  return connectSlot("main", XRPL_WS);
}

export async function getClioClient(): Promise<Client> {
  if (CLIO_WS === XRPL_WS) return getClient();
  return connectSlot("clio", CLIO_WS);
}

export async function getXrpBalanceDrops(address: string): Promise<string> {
  const client = await getClient();
  const info = await client.request({
    command: "account_info",
    account: address,
    ledger_index: "validated",
  });
  return info.result.account_data.Balance;
}
