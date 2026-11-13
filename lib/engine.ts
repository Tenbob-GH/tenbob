import type { EngineKind, TxOutcome } from "./types";
import type { TransactionMetadata, TxResponse } from "xrpl";

export type { TxOutcome };

export function classifyEngine(code: string): EngineKind {
  const prefix = code.slice(0, 3);
  if (prefix === "tes" || prefix === "tec" || prefix === "ter" || prefix === "tef" || prefix === "tem" || prefix === "tel") {
    return prefix;
  }
  return "unknown";
}

export function engineHint(code: string): string {
  switch (code) {
    case "tesSUCCESS":
      return "Validated on ledger.";
    case "tecNO_ENTRY":
      return "Offer or NFT was not found (already taken or canceled).";
    case "tecNO_PERMISSION":
      return "This account is not allowed to accept that offer (check Destination / broker).";
    case "tecINSUFFICIENT_FUNDS":
      return "Not enough XRP after reserves.";
    case "tecEXPIRED":
      return "The offer has expired.";
    case "tecDIR_FULL":
      return "Directory is full; try again later.";
    case "tecNO_DST":
      return "Destination account does not exist.";
    case "tecFROZEN":
      return "A involved trust line is frozen.";
    case "terQUEUED":
      return "Queued; waiting for open ledger.";
    case "temMALFORMED":
      return "Transaction was malformed (check flags, URI hex, amounts).";
    case "temBAD_FEE":
      return "Fee field is invalid.";
    case "tefPAST_SEQ":
      return "Sequence already used; retry with a fresh autofill.";
    case "tefMAX_LEDGER":
      return "LastLedgerSequence passed; submit again.";
    default:
      return code.startsWith("tes")
        ? "Success class result."
        : code.startsWith("tec")
          ? "Failed, fee paid, no ledger mutation beyond that."
          : code.startsWith("ter")
            ? "Retryable; not applied yet."
            : code.startsWith("tef")
              ? "Claimed failure; do not retry the same signed tx."
              : code.startsWith("tem")
                ? "Malformed; do not retry without changes."
                : "";
  }
}

export function outcomeFromTx(result: TxResponse, fallbackMessage?: string): TxOutcome {
  const meta = result.result.meta;
  const engine =
    typeof meta === "object" && meta && "TransactionResult" in meta
      ? (meta as TransactionMetadata).TransactionResult
      : "unknown";
  return {
    ok: engine === "tesSUCCESS",
    hash: result.result.hash,
    engineResult: engine,
    engineResultMessage: fallbackMessage ?? engineHint(engine),
    kind: classifyEngine(engine),
  };
}

export function outcomeFromEngine(
  engineResult: string,
  hash?: string,
  message?: string,
): TxOutcome {
  return {
    ok: engineResult === "tesSUCCESS",
    hash,
    engineResult,
    engineResultMessage: message ?? engineHint(engineResult),
    kind: classifyEngine(engineResult),
  };
}

export function asUnsigned<T extends Record<string, unknown>>(tx: T): T {
  const copy = { ...tx };
  delete copy.Fee;
  delete copy.Sequence;
  delete copy.LastLedgerSequence;
  delete copy.SigningPubKey;
  delete copy.TxnSignature;
  delete copy.Signers;
  return copy;
}
