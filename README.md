# Tenbob — XRPL NFT Marketplace

Native [XLS-20](https://xrpl.org/docs/concepts/tokens/nfts) NFTs on the XRP Ledger. No Ethereum, no Solidity, no wrapped tokens.

The app talks to a rippled / Clio websocket with `xrpl.js`. Wallets (Xaman, Crossmark, GemWallet) sign every write. Keys never leave the wallet.

## Quick start

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000

## Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_XRPL_WS` | client + server | Ledger websocket. Default Testnet `wss://s.altnet.rippletest.net:51233` |
| `NEXT_PUBLIC_XRPL_CLIO_WS` | client + server | Clio endpoint for `nft_info` / `nfts_by_issuer` |
| `NEXT_PUBLIC_APP_URL` | server | Public origin used when hosting metadata JSON |
| `NEXT_PUBLIC_BROKER_ADDRESS` | client + server | Marketplace broker classic address. Empty = 0% fee, direct `NFTokenAcceptOffer` |
| `BROKER_SEED` | **server only** | Signs `POST /api/broker/accept`. Never expose this |
| `NEXT_PUBLIC_BROKER_FEE_BPS` | client + server | Platform fee in basis points. `150` = 1.5% |
| `XUMM_API_KEY` / `XUMM_API_SECRET` | server | Enables Xaman connect + sign |
| `PINATA_JWT` | server | Optional IPFS pin for image + metadata |
| `NEXT_PUBLIC_DEV_SEED` | client, **dev only** | Testnet automation. The UI is hidden unless `NODE_ENV=development` |

### Switch to Mainnet

Set one line in `.env.local`:

```
NEXT_PUBLIC_XRPL_WS=wss://xrplcluster.com
NEXT_PUBLIC_XRPL_CLIO_WS=wss://xrplcluster.com
```

Restart the app. Do **not** use `NEXT_PUBLIC_DEV_SEED` on mainnet.

## Testnet faucet

Fund classic accounts at the official faucet:

https://faucet.altnet.rippletest.net/

or https://xrpl.org/resources/dev-tools/xrp-faucets

Crossmark / GemWallet must be set to **Testnet** when `NEXT_PUBLIC_XRPL_WS` points at altnet.

## Mint → list → buy

1. Connect Xaman, Crossmark, or GemWallet (or the hidden dev-seed control in development).
2. Fund the account from the faucet if the reserve is missing.
3. Open **Mint** (`/create`). Name, description, HTTPS or `ipfs://` image, taxon, royalty % (TransferFee, `1000` = 1%). Flags default to `9` (burnable + transferable).
4. Metadata JSON `{ name, description, image, attributes }` is stored (Pinata if `PINATA_JWT` is set, otherwise `/api/metadata/[id]`). That URL is hex-encoded into `NFTokenMint.URI`.
5. On the NFT page, enter a price in XRP and create a **sell offer** (`Flags = 1` / `tfSellToken`). If a broker address is configured, `Destination` is the broker.
6. A second wallet opens the same NFT and clicks **Buy**:
   - No broker: buyer submits `NFTokenAcceptOffer` with `NFTokenSellOffer`.
   - Broker: buyer creates a buy offer, then `POST /api/broker/accept` submits a brokered `NFTokenAcceptOffer` (`NFTokenSellOffer` + `NFTokenBuyOffer` + `NFTokenBrokerFee`).
7. Home (`/`) reads **`GET /api/listings`**, not a raw ledger scan. The indexer subscribes to the transactions stream and persists `data/listings.json`.

## Indexer

`lib/indexer.ts` watches `NFTokenMint`, `NFTokenCreateOffer`, `NFTokenAcceptOffer`, `NFTokenCancelOffer`, and `NFTokenBurn`.

APIs:

- `GET /api/listings?sort=price|recent`
- `GET /api/nft/[id]`
- `POST /api/indexer/tx` `{ hash }` — ingest a hash the UI just submitted
- `GET /api/issuer?issuer=r…` — Clio `nfts_by_issuer` fallback explorer

## Wallet adapters

Every write builds an unsigned `txJson` with `Account = connected classicAddress`, then `wallet.signAndSubmit`. The app stores only `{ classicAddress, walletType }`. Seeds and signed blobs are never logged.

Dev seed exists solely for Testnet automation behind `NEXT_PUBLIC_DEV_SEED` and is not rendered in production builds.

## Scripts

```bash
npm run test:happy-path
```

Funds two Testnet accounts via the faucet, mints, lists, buys, and checks the indexer.
