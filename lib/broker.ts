export const DEFAULT_BROKER_FEE_BPS = 150;

export function brokerAddress(): string {
  return (process.env.NEXT_PUBLIC_BROKER_ADDRESS ?? "").trim();
}

export function brokerFeeBps(): number {
  const raw = Number(process.env.NEXT_PUBLIC_BROKER_FEE_BPS ?? DEFAULT_BROKER_FEE_BPS);
  if (!Number.isFinite(raw) || raw < 0 || raw > 5000) return DEFAULT_BROKER_FEE_BPS;
  return Math.floor(raw);
}

export function brokerConfigured(): boolean {
  return brokerAddress().length > 0;
}

/** Platform take, in drops. 150 bps = 1.5%. */
export function brokerFeeDrops(priceDrops: string): string {
  const price = BigInt(priceDrops);
  const bps = BigInt(brokerFeeBps());
  if (price <= 0n || bps <= 0n) return "0";
  return ((price * bps + 9999n) / 10000n).toString();
}

/** Buy offer must cover sell amount + broker fee so seller still receives the list price. */
export function buyAmountWithBrokerFee(priceDrops: string): string {
  return (BigInt(priceDrops) + BigInt(brokerFeeDrops(priceDrops))).toString();
}

export function feePercentLabel(): string {
  return `${(brokerFeeBps() / 100).toFixed(2)}%`;
}
