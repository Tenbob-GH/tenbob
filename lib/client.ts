export async function ingestHash(hash: string | undefined) {
  if (!hash) return;
  await fetch("/api/indexer/tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hash }),
  });
}
